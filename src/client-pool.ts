import { Env, ClientStatus, OAuth2Credentials } from "./types";
import { AuthManager } from "./auth";
import { GeminiApiClient } from "./gemini-client";

let clients: GeminiApiClient[] = [];
let currentIndex = 0;
const invalidClientTimestamps: Map<number, number> = new Map(); // New: Map of invalid client indexes to their invalidation timestamp

/**
 * Initializes the pool of Gemini API clients from the environment variable.
 * This function is idempotent and can be safely called multiple times.
 */
export async function initializeClientPool(env: Env): Promise<void> {
	if (clients.length > 0) {
		return; // Already initialized
	}

	const prefix = "GEMINI_API_KEY_";
	const credentialsArray: OAuth2Credentials[] = [];

	for (const key in env) {
		if (key.startsWith(prefix)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const credentialJson = (env as any)[key];
			if (typeof credentialJson === 'string') {
				try {
					credentialsArray.push(JSON.parse(credentialJson));
				} catch (e) {
					console.error(`Failed to parse JSON for env var \`${key}\`. Skipping. Error: ${e}`);
				}
			}
		}
	}

	if (credentialsArray.length === 0) {
		throw new Error(`No environment variables with prefix \`${prefix}\` found. Please store your Gemini API keys as environment variables.`);
	}

	clients = credentialsArray.map((creds: OAuth2Credentials, index: number) => {
		const credentialJson = JSON.stringify(creds);
		const authManager = new AuthManager(env, credentialJson, index);
		const projectId = creds.project_id;
		const onInvalidClientCallback = (clientIndex: number) => {
			if (!invalidClientTimestamps.has(clientIndex)) {
				invalidClientTimestamps.set(clientIndex, Date.now());
				console.log(`Client ${clientIndex} marked as invalid due to excessive errors at ${new Date().toISOString()}.`);
			}
		};
		return new GeminiApiClient(env, authManager, projectId, onInvalidClientCallback);
	});

	console.log(`Initialized ${clients.length} Gemini API clients in the pool from environment variables with prefix '${prefix}'.`);
}

/**
 * Gets the next available GeminiApiClient from the pool using a round-robin strategy.
 * @returns {GeminiApiClient} The next client to use.
 */
export function getNextClient(): GeminiApiClient {
	if (clients.length === 0) {
		// This might happen if initialization fails but the request proceeds.
		throw new Error("Client pool is not initialized or is empty. Check your `GEMINI_API_KEYS` configuration.");
	}

	let client: GeminiApiClient | undefined;
	let clientIndex: number;
	let attempts = 0;
	const maxAttempts = clients.length; // Prevent infinite loop if all clients are invalid

	do {
		clientIndex = currentIndex;
		client = clients[clientIndex];

		currentIndex = (currentIndex + 1) % clients.length; // Move to the next client for the next call
		attempts++;

		// If the current client is invalid, try the next one
		const invalidatedTimestamp = invalidClientTimestamps.get(clientIndex);
		if (invalidatedTimestamp) {
			const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
			if (Date.now() - invalidatedTimestamp > oneHour) {
				// Client has been invalid for more than an hour, re-enable it
				invalidClientTimestamps.delete(clientIndex);
				console.log(`Client ${clientIndex} re-enabled after 1 hour of invalidation.`);
			} else {
				console.log(`Skipping invalid client at index: ${clientIndex} (invalidated at ${new Date(invalidatedTimestamp).toISOString()})`);
				client = undefined; // Reset client to continue loop
			}
		}
	} while (!client && attempts < maxAttempts);

	if (!client) {
		throw new Error("No valid clients available in the pool.");
	}

	console.log(
		`Selected client index: ${clientIndex}, URL: ${client.getEndpoint()}, Calls: ${client.getCallCount()}, Errors: ${client.getErrorCount()}, Is Valid: ${!invalidClientTimestamps.has(clientIndex)}`
	);

	return client;
}

/**
 * Returns the status of all clients in the pool for the admin dashboard.
 * @returns {ClientStatus[]} An array of client status objects.
 */
export function getClientStatuses(): ClientStatus[] {
	return clients.map((client, index) => {
		const isValid = !invalidClientTimestamps.has(index);
		const invalidatedAt = invalidClientTimestamps.get(index);
		const accessToken = client.getAuthManager().getAccessToken();
		const last8CharsOfToken = accessToken ? accessToken.slice(-8) : "N/A";

		return {
			index: index,
			last8CharsOfToken: last8CharsOfToken,
			errorCount: client.getErrorCount(),
			isValid: isValid,
			invalidatedAt: invalidatedAt
		};
	});
}