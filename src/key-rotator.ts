import { KeyManager } from "./key-manager";

// Flexible options bag accepted by provider calls
export interface GenerateOptions {
  [key: string]: any;
}

export type ProviderCallResult = {
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number } | undefined;
  tool_calls?: Array<any> | undefined;
};

export type ProviderCall = (
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: unknown[],
  options?: any
) => Promise<ProviderCallResult>;

export interface KeyRotatorOptions {
  maxRetriesPerKeyMultiplier?: number; // default 2
  perKeyCooldownSeconds?: number;
}

const MODEL_TIERS = ["gemini-2.5-pro", "gemini-2.5-flash"];

export class KeyRotator {
  private keyManager: KeyManager;
  private maxRetriesPerKeyMultiplier: number;
  private perKeyCooldownSeconds?: number;

  constructor(keyManager: KeyManager, options: KeyRotatorOptions = {}) {
    this.keyManager = keyManager;
    this.maxRetriesPerKeyMultiplier = options.maxRetriesPerKeyMultiplier ?? 2;
    this.perKeyCooldownSeconds = options.perKeyCooldownSeconds;
  }

  private async wait(ms: number): Promise<void> {
    // Use a cast to avoid lib typing differences between Node and Workers
    return new Promise((res) => (setTimeout as any)(res, ms));
  }

  private isRecoverableError(err: unknown): boolean {
    if (!err) return false;
    const e = err as any;
    const msg = (e && e.message) ? String(e.message).toLowerCase() : "";
    const status = e && (e.status || e.statusCode || e.code);
    if (status === 429 || status === 403) return true;
    if (msg.includes("rate limit") || msg.includes("quota") || msg.includes("exhaust")) return true;
    return false;
  }

  async generateContent(
    model: string,
    systemPrompt: string,
    messages: unknown[],
    providerCall: ProviderCall,
    options?: GenerateOptions
  ): Promise<ProviderCallResult> {
    const startTier = MODEL_TIERS.indexOf(model) !== -1 ? MODEL_TIERS.indexOf(model) : 0;

    // Iterate models from preferred (startTier) to fallback models.
    for (let i = startTier; i < MODEL_TIERS.length; i++) {
      const currentModel = MODEL_TIERS[i];
      // Snapshot available keys for this attempt; KeyManager manages exhaustion state.
      const availableKeys = this.keyManager.getAvailableKeys();
      if (!availableKeys || availableKeys.length === 0) continue;

      const triedKeys = new Set<string>();

      // Try each available key once for the current model before falling back to next model
      for (let k = 0; k < availableKeys.length; k++) {
        const key = this.keyManager.getNextAvailableKey();
        if (!key || triedKeys.has(key)) {
          // If we've tried all known available keys, break
          if (triedKeys.size >= availableKeys.length) break;
          continue;
        }

        triedKeys.add(key);

        try {
          console.log(`Attempting to use key ${this.keyManager.maskKey(key)} for model ${currentModel}`);
          const result = await providerCall(key, currentModel, systemPrompt, messages, options);
          return result;
        } catch (err) {
          if (this.isRecoverableError(err)) {
            console.log(`Key ${this.keyManager.maskKey(key)} failed for model ${currentModel}, marking as exhausted.`);
            await this.keyManager.markKeyExhausted(key, currentModel, this.perKeyCooldownSeconds);
            await this.wait(100);
            continue;
          }
          throw err;
        }
      }
      // No keys in this model succeeded; move to next model tier
    }

    throw new Error("No available API keys or all attempts failed");
  }

  async *streamContent(
    model: string,
    systemPrompt: string,
    messages: unknown[],
    providerStream: (
      apiKey: string,
      model: string,
      systemPrompt: string,
      messages: unknown[],
      options?: any
    ) => AsyncGenerator<any>,
    options?: GenerateOptions
  ): AsyncGenerator<any> {
    const startTier = MODEL_TIERS.indexOf(model) !== -1 ? MODEL_TIERS.indexOf(model) : 0;

  for (let i = startTier; i < MODEL_TIERS.length; i++) {
    const currentModel = MODEL_TIERS[i];
    const availableKeys = this.keyManager.getAvailableKeys();
    if (!availableKeys || availableKeys.length === 0) continue;

    const triedKeys = new Set<string>();

    for (let k = 0; k < availableKeys.length; k++) {
      const key = this.keyManager.getNextAvailableKey();
      if (!key || triedKeys.has(key)) {
        if (triedKeys.size >= availableKeys.length) break;
        continue;
      }

      triedKeys.add(key);

      try {
        console.log(`Attempting to use key ${this.keyManager.maskKey(key)} for model ${currentModel} (stream)`);
        for await (const chunk of providerStream(key, currentModel, systemPrompt, messages, options)) {
          yield chunk;
        }
        return;
      } catch (err) {
        if (this.isRecoverableError(err)) {
          console.log(`Key ${this.keyManager.maskKey(key)} failed for model ${currentModel} (stream), marking as exhausted.`);
          await this.keyManager.markKeyExhausted(key, currentModel, this.perKeyCooldownSeconds);
          await this.wait(100);
          continue;
        }
        throw err;
      }
    }
  }

    throw new Error("No available API keys or all attempts failed (stream)");
  }

  getStatus(): ReturnType<KeyManager["getStatusSnapshot"]> {
    return this.keyManager.getStatusSnapshot();
  }
}

export default KeyRotator;
