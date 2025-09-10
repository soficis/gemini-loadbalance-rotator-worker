#!/usr/bin/env node
/**
 * import-keys.js
 *
 * Usage:
 *  node ./scripts/import-keys.js            # write keys into .dev.vars (dev mode)
 *  node ./scripts/import-keys.js --wrangler  # attempt to push keys as wrangler secrets (interactive)
 *
 * Behavior:
 *  - Reads gemini_key_rotator_v16/keys.txt
 *  - Detects formats:
 *      - JSON array: ["key1","key2"]
 *      - KEY=VALUE per-line
 *      - one key per line (plain)
 *  - Writes a .dev.vars file with GEMINI_API_KEY_1, GEMINI_API_KEY_2, ...
 *  - Sets .dev.vars mode to 600 (owner read/write) where possible
 *  - If --wrangler is passed, will attempt to run `wrangler secret put GEMINI_API_KEY_<N>` for each key
 *    (requires `wrangler` configured and logged in). Failures are reported but do not abort saving .dev.vars.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const KEYS_PATH = path.join(__dirname, "..", "gemini_key_rotator_v16", "keys.txt");
const DEVVARS = path.join(process.cwd(), ".dev.vars");

function readKeysFile() {
  if (!fs.existsSync(KEYS_PATH)) throw new Error(`Keys file not found: ${KEYS_PATH}`);
  const raw = fs.readFileSync(KEYS_PATH, "utf8").trim();
  if (!raw) return [];

  // Try JSON
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // KEY=VALUE lines -> extract VALUE
  const kv = lines.every((l) => l.includes("="));
  if (kv) {
    return lines.map((l) => {
      const idx = l.indexOf("=");
      return l.substring(idx + 1).trim();
    }).filter(Boolean);
  }

  // Otherwise each line is a key
  return lines;
}

function writeDevVars(keys) {
  const lines = [];
  keys.forEach((k, i) => {
    const name = `GEMINI_API_KEY_${i + 1}`;
    // Wrap value in single quotes to be safe
    lines.push(`${name}='${k.replace(/'/g, "'\"'\"'")}'`);
  });
  // Add optional CSV var for quick use
  lines.push(`GEMINI_API_KEYSCSV='${keys.join(",")}'`);
  const content = lines.join("\n") + "\n";
  fs.writeFileSync(DEVVARS, content, { mode: 0o600 });
  try {
    fs.chmodSync(DEVVARS, 0o600);
  } catch (e) {
    // ignore on platforms that don't support chmod
  }
  console.log(`Wrote ${keys.length} keys to ${DEVVARS} (mode 600).`);
}

function pushToWrangler(keys) {
  console.log("Attempting to write keys to Wrangler secrets (requires wrangler login).");
  keys.forEach((k, i) => {
    const name = `GEMINI_API_KEY_${i + 1}`;
    try {
      // Spawn wrangler secret put NAME and write key to stdin
      const ps = spawnSync("wrangler", ["secret", "put", name], {
        input: Buffer.from(k),
        stdio: ["pipe", "inherit", "inherit"],
        shell: true
      });
      if (ps.status !== 0) {
        console.error(`Failed to set secret ${name} (exit ${ps.status}).`);
      } else {
        console.log(`Set secret ${name} in Wrangler.`);
      }
    } catch (err) {
      console.error(`Error setting secret ${name}:`, err.message || err);
    }
  });
}

function ensureGitignore() {
  const gitignore = path.join(process.cwd(), ".gitignore");
  const rel = "gemini_key_rotator_v16/keys.txt";
  let content = "";
  if (fs.existsSync(gitignore)) content = fs.readFileSync(gitignore, "utf8");
  if (!content.includes(rel)) {
    content = content.trimEnd() + "\n\n# Secrets / local keys\n" + rel + "\n";
    fs.writeFileSync(gitignore, content, { encoding: "utf8" });
    console.log(`Appended ${rel} to .gitignore`);
  } else {
    console.log(`${rel} already present in .gitignore`);
  }
}

(async function main() {
  const args = process.argv.slice(2);
  const useWrangler = args.includes("--wrangler");

  let keys;
  try {
    keys = readKeysFile();
  } catch (e) {
    console.error("Error reading keys file:", e.message || e);
    process.exit(2);
  }
  if (!keys || keys.length === 0) {
    console.error("No keys found in keys file.");
    process.exit(2);
  }

  // Basic validation: keys should look like API keys (alphanumeric, - , _)
  const bad = keys.filter((k) => !/^[A-Za-z0-9_\-]+$/.test(k));
  if (bad.length) {
    console.warn("Warning: Some keys have unexpected characters; they will still be written but please verify:");
    bad.forEach((b) => console.warn("  -", b));
  }

  writeDevVars(keys);
  ensureGitignore();

  if (useWrangler) {
    pushToWrangler(keys);
  }

  console.log("Import complete. .dev.vars is ready for local development.");
  console.log("To use it locally (bash):");
  console.log("  export $(cat .dev.vars | xargs) && npm run dev");
})();