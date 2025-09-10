/**
 * Worker-compatible KeyManager (KV-first).
 * Keeps an in-memory map of key exhaustion timestamps and persists to Cloudflare KV when available.
 */

export interface KeyExhaustionRecord {
  exhaustedUntil?: number; // epoch ms when key becomes available again
  lastExhaustedModel?: string;
}

export interface KeyManagerOptions {
  keys?: string[]; // explicit keys list
  tierCooldownSeconds?: number; // default cooldown for exhausted keys
  kv?: any; // optional Cloudflare KVNamespace (typed as any for compatibility)
  kvKey?: string; // optional key name in KV
}

export class KeyManager {
  private keys: string[] = [];
  private keyStatus: Record<string, KeyExhaustionRecord> = {};
  private tierCooldownMs: number;
  private kv?: any;
  private kvKey: string;

  constructor(options: KeyManagerOptions = {}) {
    this.tierCooldownMs = (options.tierCooldownSeconds ?? 3600) * 1000; // default 1 hour
    this.kv = options.kv;
    this.kvKey = options.kvKey ?? "gemini_key_rotator:cooldown_data_v1";

    if (options.keys && options.keys.length > 0) {
      this.setKeys(options.keys);
    }

    // Best-effort load persisted KV state
    this.loadState().catch(() => {
      /* ignore load errors */
    });
  }

  setKeys(keys: string[]): void {
    this.keys = Array.from(new Set(keys));
    for (const k of this.keys) {
      if (!this.keyStatus[k]) this.keyStatus[k] = {};
    }
    // remove statuses for keys that no longer exist
    for (const k of Object.keys(this.keyStatus)) {
      if (!this.keys.includes(k)) {
        delete this.keyStatus[k];
      }
    }
  }

  /**
   * Load keys from a file path or HTTP(S) URL.
   * - If the path starts with http/https, fetch it and parse JSON or newline-separated keys.
   * - Otherwise, attempt to read from the local filesystem (Node). In Workers this will throw.
   */
  async loadKeysFromFile(pathOrUrl: string): Promise<void> {
    if (!pathOrUrl) return;
    let content = "";
    try {
      if (typeof pathOrUrl === "string" && (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://"))) {
        const resp = await fetch(pathOrUrl);
        if (!resp.ok) throw new Error(`Failed to fetch keys from URL: ${resp.status}`);
        content = await resp.text();
      } else {
        // Try Node fs - dynamic import to avoid bundling in Worker environments
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = await import("fs");
          content = fs.readFileSync(pathOrUrl, "utf8");
        } catch (fsErr) {
          throw new Error("Unable to read keysFile in this runtime: " + String(fsErr));
        }
      }

      // Try JSON parse first
      let keys: string[] = [];
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          keys = parsed.map((k) => String(k).trim()).filter(Boolean);
        }
      } catch {
        // Fallback: newline-separated
        keys = content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
      }

      if (keys.length > 0) {
        this.setKeys(keys);
      } else {
        throw new Error("No keys found in provided file/url");
      }
    } catch (err) {
      // bubble up error so caller can decide; keep original behavior minimal
      throw err;
    }
  }

  getNextAvailableKey(): string | null {
    const now = Date.now();
    const available = this.keys.filter((k) => {
      const rec = this.keyStatus[k];
      if (!rec) return true;
      if (!rec.exhaustedUntil) return true;
      return rec.exhaustedUntil <= now;
    });

    if (available.length === 0) return null;
    const idx = Math.floor(Math.random() * available.length);
    return available[idx];
  }

  async markKeyExhausted(key: string, model?: string, cooldownSeconds?: number): Promise<void> {
    if (!this.keys.includes(key)) this.keys.push(key);
    const ms = (cooldownSeconds ?? Math.round(this.tierCooldownMs / 1000)) * 1000;
    const until = Date.now() + ms;
    this.keyStatus[key] = {
      exhaustedUntil: until,
      lastExhaustedModel: model
    };
    await this.saveState();
  }

  isKeyAvailable(key: string): boolean {
    const rec = this.keyStatus[key];
    if (!rec) return true;
    if (!rec.exhaustedUntil) return true;
    return rec.exhaustedUntil <= Date.now();
  }

  getAvailableKeysCount(): number {
    const now = Date.now();
    return this.keys.reduce((acc, k) => {
      const rec = this.keyStatus[k];
      if (!rec || !rec.exhaustedUntil || rec.exhaustedUntil <= now) return acc + 1;
      return acc;
    }, 0);
  }

  getTotalKeysCount(): number {
    return this.keys.length;
  }

  maskKey(key?: string | null): string {
    if (!key) return "<no-key>";
    if (key.length <= 8) return `${key[0]}***${key.slice(-1)}`;
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  private async saveState(): Promise<void> {
    const payload = {
      keys: this.keys,
      keyStatus: this.keyStatus,
      savedAt: Date.now()
    };
    if (this.kv) {
      try {
        await this.kv.put(this.kvKey, JSON.stringify(payload));
      } catch (err) {
        // best-effort
        // eslint-disable-next-line no-console
        console.error("KeyManager.saveState KV error:", err);
      }
    }
  }

  private async loadState(): Promise<void> {
    if (!this.kv) return;
    try {
      const raw = await this.kv.get(this.kvKey);
      if (!raw) return;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(await raw.text());
      if (parsed.keys && parsed.keys.length > 0) {
        this.keys = Array.from(new Set([...this.keys, ...parsed.keys]));
      }
      if (parsed.keyStatus) {
        for (const [k, v] of Object.entries(parsed.keyStatus)) {
          this.keyStatus[k] = v as KeyExhaustionRecord;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("KeyManager.loadState KV error:", err);
    }
  }

  getStatusSnapshot() {
    const now = Date.now();
    const details = this.keys.map((k) => {
      const r = this.keyStatus[k] || {};
      const available = !r.exhaustedUntil || r.exhaustedUntil <= now;
      return {
        key: this.maskKey(k),
        available,
        exhaustedUntil: r.exhaustedUntil,
        lastExhaustedModel: r.lastExhaustedModel
      };
    });
    return {
      total: this.getTotalKeysCount(),
      available: this.getAvailableKeysCount(),
      details
    };
  }
}

export default KeyManager;