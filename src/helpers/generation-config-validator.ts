import { geminiCliModels } from "../models";
import {
	DEFAULT_THINKING_BUDGET,
	DEFAULT_TEMPERATURE,
	REASONING_EFFORT_BUDGETS,
	GEMINI_SAFETY_CATEGORIES
} from "../constants";
import { ChatCompletionRequest, Env, EffortLevel, SafetyThreshold } from "../types";

/**
 * Helper class to validate and correct generation configurations for different Gemini models.
 * Handles model-specific limitations and provides sensible defaults.
 */
export class GenerationConfigValidator {
	/**
	 * Maps reasoning effort to thinking budget based on model type.
	 * @param effort - The reasoning effort level
	 * @param modelId - The model ID to determine if it's a flash model
	 * @returns The corresponding thinking budget
	 */
	static mapEffortToThinkingBudget(effort: EffortLevel, modelId: string): number {
		const isFlashModel = modelId.includes("flash");

		switch (effort) {
			case "none":
				return REASONING_EFFORT_BUDGETS.none;
			case "low":
				return REASONING_EFFORT_BUDGETS.low;
			case "medium":
				return isFlashModel ? REASONING_EFFORT_BUDGETS.medium.flash : REASONING_EFFORT_BUDGETS.medium.default;
			case "high":
				return isFlashModel ? REASONING_EFFORT_BUDGETS.high.flash : REASONING_EFFORT_BUDGETS.high.default;
			default:
				return DEFAULT_THINKING_BUDGET;
		}
	}

	/**
	 * Type guard to check if a value is a valid EffortLevel.
	 * @param value - The value to check
	 * @returns True if the value is a valid EffortLevel
	 */
	static isValidEffortLevel(value: unknown): value is EffortLevel {
		return typeof value === "string" && ["none", "low", "medium", "high"].includes(value);
	}

	/**
	 * Creates safety settings configuration for Gemini API.
	 * @param env - Environment variables containing safety thresholds
	 * @returns Safety settings configuration
	 */
	static createSafetySettings(env: Env): Array<{ category: string; threshold: SafetyThreshold }> {
		const safetySettings: Array<{ category: string; threshold: SafetyThreshold }> = [];

		if (env.GEMINI_MODERATION_HARASSMENT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.HARASSMENT,
				threshold: env.GEMINI_MODERATION_HARASSMENT_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_HATE_SPEECH_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.HATE_SPEECH,
				threshold: env.GEMINI_MODERATION_HATE_SPEECH_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.SEXUALLY_EXPLICIT,
				threshold: env.GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.DANGEROUS_CONTENT,
				threshold: env.GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD
			});
		}

		return safetySettings;
	}

	/**
	 * Validates and corrects the thinking budget for a specific model.
	 * @param modelId - The Gemini model ID
	 * @param thinkingBudget - The requested thinking budget
	 * @returns The corrected thinking budget
	 */
	static validateThinkingBudget(modelId: string, thinkingBudget: number): number {
		const modelInfo = geminiCliModels[modelId];

		// For thinking models, validate the budget
		if (modelInfo?.thinking) {
			// Gemini 2.5 Pro and Flash don't support thinking_budget: 0
			// They require -1 (dynamic allocation) or positive numbers
			if (thinkingBudget === 0) {
				console.log(`[GenerationConfig] Model '${modelId}' doesn't support thinking_budget: 0, using -1 instead`);
				return DEFAULT_THINKING_BUDGET; // -1
			}

			// Validate positive budget values (optional: add upper limits if needed)
			if (thinkingBudget < -1) {
				console.log(
					`[GenerationConfig] Invalid thinking_budget: ${thinkingBudget} for model '${modelId}', using -1 instead`
				);
				return DEFAULT_THINKING_BUDGET; // -1
			}
		}

		return thinkingBudget;
	}

	/**
	 * Creates a validated generation config for a specific model.
	 * @param modelId - The Gemini model ID
	 * @param options - Generation options including thinking budget and OpenAI parameters
	 * @param isRealThinkingEnabled - Whether real thinking is enabled
	 * @param includeReasoning - Whether to include reasoning in response
	 * @param env - Environment variables for safety settings
	 * @returns Validated generation configuration
	 */
	static createValidatedConfig(
		modelId: string,
		options: Partial<ChatCompletionRequest> = {},
		isRealThinkingEnabled: boolean,
		includeReasoning: boolean,
		env?: Env
	): Record<string, unknown> {
		const generationConfig: Record<string, unknown> = {
			temperature: options.temperature ?? DEFAULT_TEMPERATURE,
			maxOutputTokens: options.max_tokens,
			topP: options.top_p,
			stopSequences: typeof options.stop === "string" ? [options.stop] : options.stop,
			presencePenalty: options.presence_penalty,
			frequencyPenalty: options.frequency_penalty,
			seed: options.seed
		};

		if (options.response_format?.type === "json_object") {
			generationConfig.responseMimeType = "application/json";
		}

		// Add safety settings if environment variables are provided
		if (env) {
			const safetySettings = this.createSafetySettings(env);
			if (safetySettings.length > 0) {
				generationConfig.safetySettings = safetySettings;
			}
		}

		const modelInfo = geminiCliModels[modelId];
		const isThinkingModel = modelInfo?.thinking || false;

		if (isThinkingModel) {
			let thinkingBudget = options.thinking_budget ?? DEFAULT_THINKING_BUDGET;

			// Handle reasoning effort mapping to thinking budget
			const reasoning_effort =
				options.reasoning_effort || options.extra_body?.reasoning_effort || options.model_params?.reasoning_effort;

			if (reasoning_effort && this.isValidEffortLevel(reasoning_effort)) {
				thinkingBudget = this.mapEffortToThinkingBudget(reasoning_effort, modelId);
				// If effort is "none", disable reasoning
				if (reasoning_effort === "none") {
					includeReasoning = false;
				} else {
					includeReasoning = true;
				}
			}

			const validatedBudget = this.validateThinkingBudget(modelId, thinkingBudget);

			if (isRealThinkingEnabled && includeReasoning) {
				// Enable thinking with validated budget
				generationConfig.thinkingConfig = {
					thinkingBudget: validatedBudget,
					includeThoughts: true // Critical: This enables thinking content in response
				};
				console.log(`[GenerationConfig] Real thinking enabled for '${modelId}' with budget: ${validatedBudget}`);
			} else {
				// For thinking models, always use validated budget (can't use 0)
				// Control thinking visibility with includeThoughts instead
				generationConfig.thinkingConfig = {
					thinkingBudget: this.validateThinkingBudget(modelId, DEFAULT_THINKING_BUDGET),
					includeThoughts: false // Disable thinking visibility in response
				};
			}
		}

		// Remove undefined keys
		Object.keys(generationConfig).forEach((key) => generationConfig[key] === undefined && delete generationConfig[key]);
		return generationConfig;
	}

	static createValidateTools(options: Partial<ChatCompletionRequest> = {}) {
		const tools = [];
		let toolConfig = {};
		// Add tools configuration if provided
		if (Array.isArray(options.tools) && options.tools.length > 0) {
			const functionDeclarations = options.tools.map((tool) => {
				let parameters = tool.function.parameters;
				// Filter parameters for Claude-style compatibility by removing keys starting with '$'
				if (parameters) {
					const before = parameters;
					parameters = Object.keys(parameters)
						.filter((key) => !key.startsWith("$"))
						.reduce(
							(after, key) => {
								after[key] = before[key];
								return after;
							},
							{} as Record<string, unknown>
						);
				}
				return {
					name: tool.function.name,
					description: tool.function.description,
					parameters
				};
			});

			tools.push({ functionDeclarations });
			// Handle tool choice
			if (options.tool_choice) {
				if (options.tool_choice === "auto") {
					toolConfig = { functionCallingConfig: { mode: "AUTO" } };
				} else if (options.tool_choice === "none") {
					toolConfig = { functionCallingConfig: { mode: "NONE" } };
				} else if (typeof options.tool_choice === "object" && options.tool_choice.function) {
					toolConfig = {
						functionCallingConfig: {
							mode: "ANY",
							allowedFunctionNames: [options.tool_choice.function.name]
						}
					};
				}
			}
		}

		return { tools, toolConfig };
	}
}
