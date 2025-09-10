import { Hono } from "hono";
import { Env, ChatCompletionRequest, ChatCompletionResponse, ChatMessage, ToolCall } from "../types";
import { geminiCliModels, DEFAULT_MODEL, getAllModelIds } from "../models";
import { OPENAI_MODEL_OWNER } from "../config";
import { DEFAULT_THINKING_BUDGET } from "../constants";
// REMOVED: import { AuthManager } from "../auth";
// REMOVED: import { GeminiApiClient } from "../gemini-client";
import { initializeClientPool, getNextClient, getClientStatuses } from "../client-pool"; // ADDED
import { createOpenAIStreamTransformer } from "../stream-transformer";
import KeyManager from "../key-manager";
import KeyRotator from "../key-rotator";

/**
 * OpenAI-compatible API routes for models and chat completions.
 */
export const OpenAIRoute = new Hono<{ Bindings: Env }>();

// List available models
OpenAIRoute.get("/models", async (c) => {
	const modelData = getAllModelIds().map((modelId) => ({
		id: modelId,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: OPENAI_MODEL_OWNER
	}));

	return c.json({
		object: "list",
		data: modelData
	});
});

// Chat completions endpoint
OpenAIRoute.post("/chat/completions", async (c) => {
	try {
		console.log("Chat completions request received");
		const body = await c.req.json<ChatCompletionRequest>();
		const model = body.model || DEFAULT_MODEL;
		const messages = body.messages || [];
		// OpenAI API compatibility: stream defaults to true unless explicitly set to false
		const stream = body.stream !== false;

		// Check environment settings for real thinking
		const isRealThinkingEnabled = c.env.ENABLE_REAL_THINKING === "true";
		let includeReasoning = isRealThinkingEnabled; // Automatically enable reasoning when real thinking is enabled
		let thinkingBudget = body.thinking_budget ?? DEFAULT_THINKING_BUDGET; // Default to dynamic allocation

		// Newly added parameters
		const generationOptions = {
			max_tokens: body.max_tokens,
			temperature: body.temperature,
			top_p: body.top_p,
			stop: body.stop,
			presence_penalty: body.presence_penalty,
			frequency_penalty: body.frequency_penalty,
			seed: body.seed,
			response_format: body.response_format
		};

		// Handle effort level mapping to thinking_budget (check multiple locations for client compatibility)
		const reasoning_effort =
			body.reasoning_effort || body.extra_body?.reasoning_effort || body.model_params?.reasoning_effort;
		if (reasoning_effort) {
			includeReasoning = true; // Effort implies reasoning
			const isFlashModel = model.includes("flash");
			switch (reasoning_effort) {
				case "low":
					thinkingBudget = 1024;
					break;
				case "medium":
					thinkingBudget = isFlashModel ? 12288 : 16384;
					break;
				case "high":
					thinkingBudget = isFlashModel ? 24576 : 32768;
					break;
				case "none":
					thinkingBudget = 0;
					includeReasoning = false;
					break;
			}
		}

		const tools = body.tools;
		const tool_choice = body.tool_choice;

		console.log("Request body parsed:", {
			model,
			messageCount: messages.length,
			stream,
			includeReasoning,
			thinkingBudget,
			tools,
			tool_choice
		});

		if (!messages.length) {
			return c.json({ error: "messages is a required field" }, 400);
		}

		// Validate model
		if (!(model in geminiCliModels)) {
			return c.json(
				{
					error: `Model '${model}' not found. Available models: ${getAllModelIds().join(", ")}`
				},
				400
			);
		}

		// Check if the request contains images and validate model support
		const hasImages = messages.some((msg) => {
			if (Array.isArray(msg.content)) {
				return msg.content.some((content) => content.type === "image_url");
			}
			return false;
		});

		if (hasImages && !geminiCliModels[model].supportsImages) {
			return c.json(
				{
					error: `Model '${model}' does not support image inputs. Please use a vision-capable model like gemini-2.5-pro or gemini-2.5-flash.`
				},
				400
			);
		}

		// Extract system prompt and user/assistant messages
		let systemPrompt = "";
		const otherMessages = messages.filter((msg) => {
			if (msg.role === "system") {
				// Handle system messages with both string and array content
				if (typeof msg.content === "string") {
					systemPrompt = msg.content;
				} else if (Array.isArray(msg.content)) {
					// For system messages, only extract text content
					const textContent = msg.content
						.filter((part) => part.type === "text")
						.map((part) => part.text || "")
						.join(" ");
					systemPrompt = textContent;
				}
				return false;
			}
			return true;
		});

		// Initialize the client pool (it's safe to call this on every request)
		try {
			await initializeClientPool(c.env);
		} catch (err) {
			return c.json({ error: (err as Error).message }, 500);
		}
	
		// Optionally initialize KeyManager/KeyRotator if GEMINI_KEYS or GEMINI_KEYS_FILE is provided
		let keyRotator: KeyRotator | null = null;
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const envKeys = (c.env as any).GEMINI_KEYS as string | undefined;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const keysFile = (c.env as any).GEMINI_KEYS_FILE as string | undefined;
			if (envKeys || keysFile) {
				const km = new KeyManager({ kv: c.env.GEMINI_CLI_LOADBALANCE, kvKey: "gemini_key_rotator:cooldown_data_v1" });
				if (envKeys) {
					const keys = envKeys.split(",").map((s) => s.trim()).filter(Boolean);
					if (keys.length) km.setKeys(keys);
				}
				if (keysFile) {
					// loadKeysFromFile is async and will populate keys; await it to ensure availability
					await km.loadKeysFromFile(keysFile);
				}
				keyRotator = new KeyRotator(km);
				console.log("Initialized KeyRotator with", km.getTotalKeysCount(), "keys");
			}
		} catch (krErr) {
			console.error("Failed to initialize KeyRotator:", krErr);
			// proceed without rotator
			keyRotator = null;
		}
	
		// Get the next client from the pool (fallback for when KeyRotator is not configured)
		const geminiClient = getNextClient();

		if (stream) {
			// Streaming response
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const openAITransformer = createOpenAIStreamTransformer(model);
			const openAIStream = readable.pipeThrough(openAITransformer);

			// Asynchronously pipe data from Gemini to transformer
			(async () => {
				try {
					console.log("Starting stream generation");
					let geminiStream;
					if (keyRotator) {
						// Use KeyRotator's streaming-aware rotation and delegate actual network calls
						geminiStream = keyRotator.streamContent(
							model,
							systemPrompt,
							otherMessages,
							(apiKey, _model, _systemPrompt, _messages, _options) =>
								// Delegate to a pool client to perform the request using the raw apiKey
								// Note: getNextClient() is safe because the pool is initialized above.
								// We bind the call so it returns the AsyncGenerator expected by KeyRotator.
								geminiClient.streamContentWithApiKey(apiKey, _model, _systemPrompt as string, _messages as ChatMessage[], _options),
							{
								includeReasoning,
								thinkingBudget,
								tools,
								tool_choice,
								...generationOptions
							}
						);
					} else {
						geminiStream = geminiClient.streamContent(model, systemPrompt, otherMessages, {
							includeReasoning,
							thinkingBudget,
							tools,
							tool_choice,
							...generationOptions
						});
					}

					for await (const chunk of geminiStream) {
						await writer.write(chunk);
					}
					console.log("Stream completed successfully");
					await writer.close();
				} catch (streamError: unknown) {
					const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
					console.error("Stream error:", errorMessage);
					// Try to write an error chunk before closing
					await writer.write({
						type: "text",
						data: `Error: ${errorMessage}`
					});
					await writer.close();
				}
			})();

			// Return streaming response
			console.log("Returning streaming response");
			return new Response(openAIStream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization"
				}
			});
		} else {
			// Non-streaming response
			try {
				console.log("Starting non-streaming completion");
	
				let completion;
	
				if (keyRotator) {
					// Minimal providerCall that delegates to the existing gemini client.
					// Note: providerCall receives an apiKey but this minimal implementation
					// uses the configured client pool (geminiClient) to perform the request.
					const providerCall = async (
						apiKey: string,
						_model: string,
						_systemPrompt: string,
						_messages: unknown[],
						_options?: Record<string, unknown>
					) => {
						// Use the raw API key path on the Gemini client so KeyRotator can rotate across keys.
						// This calls the client method that accepts a raw apiKey and performs the network request.
						return await geminiClient.getCompletionWithApiKey(apiKey, _model, _systemPrompt as string, _messages as ChatMessage[], _options);
					};
	
					completion = await keyRotator.generateContent(model, systemPrompt, otherMessages, providerCall, {
						includeReasoning,
						thinkingBudget,
						tools,
						tool_choice,
						...generationOptions
					});
				} else {
					completion = await geminiClient.getCompletion(model, systemPrompt, otherMessages, {
						includeReasoning,
						thinkingBudget,
						tools,
						tool_choice,
						...generationOptions
					});
				}
	
				const response: ChatCompletionResponse = {
					id: `chatcmpl-${crypto.randomUUID()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: model,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: completion.content,
								tool_calls: completion.tool_calls as ToolCall[] | undefined
							},
							finish_reason: completion.tool_calls && completion.tool_calls.length > 0 ? "tool_calls" : "stop"
						}
					]
				};
	
				// Add usage information if available (guard optional fields)
				if (completion.usage) {
					const inputTokens = completion.usage.inputTokens ?? 0;
					const outputTokens = completion.usage.outputTokens ?? 0;
					response.usage = {
						prompt_tokens: inputTokens,
						completion_tokens: outputTokens,
						total_tokens: inputTokens + outputTokens
					};
				}
	
				console.log("Non-streaming completion successful");
				return c.json(response);
			} catch (completionError: unknown) {
				const errorMessage = completionError instanceof Error ? completionError.message : String(completionError);
				console.error("Completion error:", errorMessage);
				return c.json({ error: errorMessage }, 500);
			}
		}
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Top-level error:", e);
		return c.json({ error: errorMessage }, 500);
	}
});

// Admin route to get client statuses
OpenAIRoute.get("/admin/clients", async (c) => {
	try {
		await initializeClientPool(c.env); // Ensure pool is initialized
		const clientStatuses = getClientStatuses();
		return c.json(clientStatuses);
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Error getting client statuses:", errorMessage);
		return c.json({ error: errorMessage }, 500);
	}
});

// Admin dashboard route
OpenAIRoute.get("/admin/dashboard", async (c) => {
	return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini Client Pool Dashboard</title>
    <style>
        body { font-family: sans-serif; margin: 20px; background-color: #f4f4f4; color: #333; }
        h1 { color: #0056b3; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background-color: #fff; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
        th, td { padding: 12px 15px; border: 1px solid #ddd; text-align: left; }
        th { background-color: #007bff; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        tr:hover { background-color: #e9e9e9; }
        .status-valid { color: green; font-weight: bold; }
        .status-invalid { color: red; font-weight: bold; }
        .refresh-button {
            background-color: #28a745;
            color: white;
            padding: 10px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
        }
        .refresh-button:hover {
            background-color: #218838;
        }
    </style>
</head>
<body>
    <h1>Gemini Client Pool Dashboard</h1>
    <button class="refresh-button" onclick="fetchClientStatuses()">Refresh Data</button>
    <table id="clientStatusTable">
        <thead>
            <tr>
                <th>Index</th>
                <th>Token (Last 8 Chars)</th>
                <th>Error Count</th>
                <th>Status</th>
                <th>Invalidated At</th>
            </tr>
        </thead>
        <tbody>
            <!-- Data will be inserted here by JavaScript -->
        </tbody>
    </table>

    <script>
        async function fetchClientStatuses() {
            try {
                const response = await fetch('/admin/clients');
                const statuses = await response.json();
                const tableBody = document.getElementById('clientStatusTable').getElementsByTagName('tbody')[0];
                tableBody.innerHTML = ''; // Clear existing rows

                statuses.forEach(client => {
                    const row = tableBody.insertRow();
                    const statusClass = client.isValid ? 'status-valid' : 'status-invalid';
                    const invalidatedAt = client.invalidatedAt ? new Date(client.invalidatedAt).toLocaleString() : 'N/A';

                    row.insertCell().textContent = client.index;
                    row.insertCell().textContent = client.last8CharsOfToken;
                    row.insertCell().textContent = client.errorCount;
                    row.insertCell().innerHTML = \`<span class="\${statusClass}">\${client.isValid ? 'Valid' : 'Invalid'}</span>\`;
                    row.insertCell().textContent = invalidatedAt;
                });
            } catch (error) {
                console.error('Error fetching client statuses:', error);
                const tableBody = document.getElementById('clientStatusTable').getElementsByTagName('tbody')[0];
                tableBody.innerHTML = '<tr><td colspan="5" style="color: red;">Error loading data. Please check console.</td></tr>';
            }
        }

        // Fetch data on page load
        window.onload = fetchClientStatuses;
        // Refresh data every 10 seconds
        setInterval(fetchClientStatuses, 10000);
    </script>
</body>
</html>
`);
});
