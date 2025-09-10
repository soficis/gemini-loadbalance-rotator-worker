/**
 * UsageTracker - KV-backed minimal usage recorder for worker runtime.
 * Stores an array of usage records under a KV key. Best-effort persistence.
 */

export interface UsageRecord {
  apiKey?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number; // epoch ms
}

export interface KeyUsageSummary {
  key: string;
  maskedKey: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  calls: number;
  lastUsed?: number;
}

export class UsageTracker {
  private kv?: any;
  private kvKey: string;
  private retentionMs: number;
  private usage: UsageRecord[] = [];

  constructor(options?: { kv?: any; kvKey?: string; retentionDays?: number }) {
    this.kv = options?.kv;
    this.kvKey = options?.kvKey ?? "gemini_key_rotator:usage_data_v1";
    this.retentionMs = (options?.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    // Best-effort load
    this.load().catch(() => {
      /* ignore */
    });
  }

  private maskKey(key?: string | null): string {
    if (!key) return "<no-key>";
    if (key.length <= 8) return `${key[0]}***${key.slice(-1)}`;
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  async recordUsage(record: Omit<UsageRecord, "timestamp"> & { timestamp?: number }): Promise<void> {
    const rec: UsageRecord = {
      apiKey: record.apiKey,
      model: record.model,
      inputTokens: record.inputTokens || 0,
      outputTokens: record.outputTokens || 0,
      timestamp: record.timestamp ?? Date.now()
    };
    this.usage.push(rec);
    await this.pruneAndSave();
  }

  private async load(): Promise<void> {
    if (!this.kv) {
      this.usage = [];
      return;
    }
    try {
      const raw = await this.kv.get(this.kvKey);
      if (!raw) {
        this.usage = [];
        return;
      }
      const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(await raw.text());
      if (Array.isArray(parsed)) {
        this.usage = parsed as UsageRecord[];
      } else {
        this.usage = [];
      }
      // prune on load
      const cutoff = Date.now() - this.retentionMs;
      this.usage = this.usage.filter((u) => typeof u.timestamp === "number" && u.timestamp >= cutoff);
    } catch (err) {
      // best-effort
      // eslint-disable-next-line no-console
      console.error("UsageTracker.load KV error:", err);
      this.usage = [];
    }
  }

  private async pruneAndSave(): Promise<void> {
    try {
      const cutoff = Date.now() - this.retentionMs;
      this.usage = this.usage.filter((u) => typeof u.timestamp === "number" && u.timestamp >= cutoff);
      if (this.kv) {
        await this.kv.put(this.kvKey, JSON.stringify(this.usage));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("UsageTracker.save KV error:", err);
    }
  }

  getKeySummaries(): KeyUsageSummary[] {
    const map: Record<string, KeyUsageSummary> = {};
    for (const u of this.usage) {
      const k = u.apiKey ?? "<no-key>";
      if (!map[k]) {
        map[k] = {
          key: k,
          maskedKey: this.maskKey(u.apiKey),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          calls: 0,
          lastUsed: undefined
        };
      }
      map[k].totalInputTokens += u.inputTokens || 0;
      map[k].totalOutputTokens += u.outputTokens || 0;
      map[k].calls += 1;
      map[k].lastUsed = Math.max(map[k].lastUsed || 0, u.timestamp);
    }
    return Object.values(map).sort((a, b) => b.calls - a.calls);
  }

  getModelUsageTotals(): Record<string, { inputTokens: number; outputTokens: number; calls: number }> {
    const map: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
    for (const u of this.usage) {
      if (!map[u.model]) map[u.model] = { inputTokens: 0, outputTokens: 0, calls: 0 };
      map[u.model].inputTokens += u.inputTokens || 0;
      map[u.model].outputTokens += u.outputTokens || 0;
      map[u.model].calls += 1;
    }
    return map;
  }

  getSnapshot() {
    return {
      totalRecords: this.usage.length,
      retentionMs: this.retentionMs,
      keys: this.getKeySummaries(),
      models: this.getModelUsageTotals()
    };
  }
}

export default UsageTracker;