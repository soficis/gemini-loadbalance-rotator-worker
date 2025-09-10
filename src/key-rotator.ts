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
    const totalKeys = this.keyManager.getTotalKeysCount();
    const maxRetries = Math.max(1, totalKeys * this.maxRetriesPerKeyMultiplier);

    const triedKeys = new Set<string>();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // pick available keys not tried yet
      // (KeyManager intentionally masks keys in its snapshot; access raw keys as a pragmatic bridge)
      const rawKeys: string[] = (this.keyManager as any).keys ?? [];

      const candidates = rawKeys.filter((k) => {
        if (triedKeys.has(k)) return false;
        return this.keyManager.isKeyAvailable(k);
      });

      if (candidates.length === 0) {
        // nothing new to try; maybe all keys exhausted
        break;
      }

      const key = candidates[Math.floor(Math.random() * candidates.length)];
      triedKeys.add(key);

      try {
        const result = await providerCall(key, model, systemPrompt, messages, options);
        return result;
      } catch (err) {
        if (this.isRecoverableError(err)) {
          // mark key exhausted and continue to next
          await this.keyManager.markKeyExhausted(key, model, this.perKeyCooldownSeconds);
          // brief backoff before retrying
          await this.wait(100);
          continue;
        }
        // non-recoverable -> rethrow
        throw err;
      }
    }

    throw new Error("No available API keys or all attempts failed");
  }

  // Streaming-aware rotation: accepts a providerStream that returns an AsyncGenerator of chunks.
  // The providerStream receives the apiKey but this minimal bridge delegates to the existing pool-managed client.
  // providerStream signature: (apiKey, model, systemPrompt, messages, options) => AsyncGenerator<unknown>
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
    const totalKeys = this.keyManager.getTotalKeysCount();
    const maxRetries = Math.max(1, totalKeys * this.maxRetriesPerKeyMultiplier);
    const triedKeys = new Set<string>();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const rawKeys: string[] = (this.keyManager as any).keys ?? [];

      const candidates = rawKeys.filter((k) => {
        if (triedKeys.has(k)) return false;
        return this.keyManager.isKeyAvailable(k);
      });

      if (candidates.length === 0) {
        break;
      }

      const key = candidates[Math.floor(Math.random() * candidates.length)];
      triedKeys.add(key);

      try {
        for await (const chunk of providerStream(key, model, systemPrompt, messages, options)) {
          yield chunk;
        }
        // Completed successfully for this key
        return;
      } catch (err) {
        if (this.isRecoverableError(err)) {
          await this.keyManager.markKeyExhausted(key, model, this.perKeyCooldownSeconds);
          await this.wait(100);
          continue;
        }
        throw err;
      }
    }

    throw new Error("No available API keys or all attempts failed (stream)");
  }

  getStatus(): ReturnType<KeyManager["getStatusSnapshot"]> {
    return this.keyManager.getStatusSnapshot();
  }
}

export default KeyRotator;