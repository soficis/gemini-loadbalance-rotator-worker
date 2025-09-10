import fs from "fs";
import path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const exists = (p: string) => fs.existsSync(p);

export interface JsonLoadOptions {
  defaultValue?: any;
}

export async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!exists(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function saveJsonAtomic(filePath: string, data: unknown): Promise<void> {
  try {
    await ensureDirForFile(filePath);
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8" });
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    console.error("saveJsonAtomic error:", err);
    throw err;
  }
}

export async function loadJson(filePath: string, opts: JsonLoadOptions = {}): Promise<any> {
  try {
    if (!exists(filePath)) {
      return opts.defaultValue ?? null;
    }
    const raw = await readFile(filePath, { encoding: "utf8" });
    return JSON.parse(raw);
  } catch (err) {
    console.error("loadJson error:", err);
    return opts.defaultValue ?? null;
  }
}

/**
 * Remove entries with exhaustedUntil older than now (cleanup stale cooldowns)
 * Expects object shape: { [key: string]: { exhaustedUntil?: number, ... } }
 */
export function cleanupExpiredCooldowns(obj: Record<string, any>, now: number = Date.now()): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!v || typeof v !== "object") continue;
    if (!v.exhaustedUntil) {
      result[k] = v;
      continue;
    }
    if (typeof v.exhaustedUntil === "number" && v.exhaustedUntil > now) {
      result[k] = v;
    }
    // otherwise skip expired entry
  }
  return result;
}

/**
 * Prune usage entries older than retentionMs.
 * Expects array of usage objects with a 'timestamp' (ms) property.
 */
export function pruneOldUsage(usageArray: Array<any>, retentionMs: number): Array<any> {
  if (!Array.isArray(usageArray)) return [];
  const cutoff = Date.now() - retentionMs;
  return usageArray.filter((u) => typeof u?.timestamp === "number" && u.timestamp >= cutoff);
}

/**
 * Convenience defaults for the rotator persistence files.
 */
export const DEFAULT_PERSISTENCE_DIR = path.resolve(process.cwd(), "gemini_key_rotator_v16", "persistence");
export const DEFAULT_COOLDOWN_FILE = path.join(DEFAULT_PERSISTENCE_DIR, "cooldown_data.json");
export const DEFAULT_KEY_USAGE_FILE = path.join(DEFAULT_PERSISTENCE_DIR, "key_usage.json");
export const DEFAULT_USAGE_FILE = path.resolve(process.cwd(), "gemini_key_rotator_v16", "usage_data.json");