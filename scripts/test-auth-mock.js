#!/usr/bin/env node
/**
 * scripts/test-auth-mock.js
 *
 * Lightweight validation script (mock/integration pre-check).
 * - Verifies that .dev.vars exists and contains GEMINI_API_KEY_* entries (or GEMINI_API_KEYSCSV)
 * - Validates key format (alphanumeric, - and _)
 * - Optional: if WORKER_URL and OPENAI_API_KEY environment variables are present,
 *   performs a POST to WORKER_URL/v1/token-test to exercise the worker auth path.
 *
 * Exit codes:
 *  0 = success
 *  2 = missing keys / validation failure
 *  3 = optional network check failed
 */

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || (async (...args) => {
  // Lazy-load node-fetch for older Node versions
  try {
    const nf = await import("node-fetch");
    return nf.default(...args);
  } catch (e) {
    throw new Error("Fetch not available in this Node runtime");
  }
});

function loadDevVars(devvarsPath) {
  if (!fs.existsSync(devvarsPath)) return null;
  const raw = fs.readFileSync(devvarsPath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(?:'(.*)'|"(.*)"|(.*))$/);
    if (m) {
      env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
    } else {
      // fallback simple split
      const i = line.indexOf("=");
      if (i > 0) {
        env[line.substring(0, i)] = line.substring(i + 1);
      }
    }
  }
  return env;
}

function collectKeysFromEnv(env) {
  const keys = [];
  for (const k of Object.keys(env)) {
    if (k.startsWith("GEMINI_API_KEY_")) {
      keys.push(env[k]);
    }
  }
  if (keys.length === 0 && env.GEMINI_API_KEYSCSV) {
    return env.GEMINI_API_KEYSCSV.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return keys;
}

(async function main() {
  const devvarsPath = path.join(process.cwd(), ".dev.vars");
  const env = loadDevVars(devvarsPath);
  if (!env) {
    console.error("Missing .dev.vars. Run `npm run import-keys` first.");
    process.exit(2);
  }

  const keys = collectKeysFromEnv(env);
  if (!keys || keys.length === 0) {
    console.error("No GEMINI_API_KEY_* or GEMINI_API_KEYSCSV found in .dev.vars.");
    process.exit(2);
  }

  console.log(`Found ${keys.length} key(s) in .dev.vars (sample 1..3):`);
  keys.slice(0, 3).forEach((k, i) => console.log(`  ${i + 1}: ${k}`));

  const bad = keys.filter((k) => !/^[A-Za-z0-9_\-]+$/.test(k));
  if (bad.length > 0) {
    console.warn("Warning: some keys contain unexpected characters:");
    bad.forEach((b) => console.warn("  -", b));
  } else {
    console.log("All keys match expected character set [A-Za-z0-9_-].");
  }

  // Optional network check
  const workerUrl = process.env.WORKER_URL || env.WORKER_URL;
  const openaiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (workerUrl && openaiKey) {
    const url = `${workerUrl.replace(/\/$/, "")}/v1/token-test`;
    console.log(`Attempting token-test POST to ${url} using OPENAI_API_KEY...`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({})
      });
      const text = await res.text();
      console.log(`Token-test response: ${res.status} ${res.statusText}`);
      console.log(text);
      if (!res.ok) {
        console.error("Token-test failed (non-2xx).");
        process.exit(3);
      }
      console.log("Optional network token-test passed.");
    } catch (e) {
      console.error("Network token-test failed:", e.message || e);
      process.exit(3);
    }
  } else {
    console.log("Skipping optional network token-test (WORKER_URL and OPENAI_API_KEY not set).");
  }

  console.log("Mock auth pre-check passed.");
  process.exit(0);
})();