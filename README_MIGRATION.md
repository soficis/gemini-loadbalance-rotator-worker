# Migration Guide: gemini-cli-openai → gemini-loadbalance-rotator-worker

This document shows how to migrate your existing gemini-cli-openai setup to this fork (gemini-loadbalance-rotator-worker). It includes KV binding, secrets mapping, wrangler edits, and quick tests.

Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (npm i -g wrangler)
- Existing gemini-cli-openai deployment or credentials (GEMINI_API_KEY_* or oauth creds)

Overview

This repo adds multi-key load balancing via a KV-backed rotator. Key runtime points:

- KV binding: GEMINI_CLI_LOADBALANCE (cooldown + usage keys)
- Configurable via env var GEMINI_KEYS (comma-separated) or KV entries
- Integration points: [`src/routes/openai.ts`](src/routes/openai.ts:1), [`src/key-manager.ts`](src/key-manager.ts:1), [`src/key-rotator.ts`](src/key-rotator.ts:1)

Quick summary commands

```bash
# create KV namespace
wrangler kv:namespace create "GEMINI_CLI_LOADBALANCE"
# note the returned namespace id and update wrangler.toml
```

1) Create KV namespace and bind

Run:

```bash
wrangler kv:namespace create "GEMINI_CLI_LOADBALANCE"
```

Copy the namespace id and update [`wrangler.toml`](wrangler.toml:1):

```toml
kv_namespaces = [
  { binding = "GEMINI_CLI_LOADBALANCE", id = "REPLACE_WITH_NAMESPACE_ID" }
]
```

2) Seed required KV keys (optional but recommended)

The rotator expects two keys in KV:

- gemini_key_rotator:cooldown_data_v1
- gemini_key_rotator:usage_data_v1

Seed them with:

```bash
wrangler kv:key put --namespace-id <namespace-id> "gemini_key_rotator:cooldown_data_v1" '{"keys":[],"keyStatus":{}}'
wrangler kv:key put --namespace-id <namespace-id> "gemini_key_rotator:usage_data_v1" '[]'
```

3) Supplying API keys / credentials

You have three options:

Option A — Quick dev: GEMINI_KEYS env var

- Add to [`wrangler.toml`](wrangler.toml:1) under [vars] or set via dashboard:

```toml
[vars]
GEMINI_KEYS = "sk-KEY1,sk-KEY2"
```

Option B — Store raw keys in KV (recommended for rotator)

- Create a JSON payload with "keys" array and put it into the cooldown KV entry:

```bash
wrangler kv:key put --namespace-id <namespace-id> "gemini_key_rotator:cooldown_data_v1" '{"keys":["sk-KEY1","sk-KEY2"],"keyStatus":{}}'
```

Option C — Convert per-key secrets from the old app

If you have secrets named GEMINI_API_KEY_1, GEMINI_API_KEY_2 in the older project, you can export and assemble them into the KV entry:

```bash
# locally, assemble a JSON array (example)
echo '["'"$GEMINI_API_KEY_1"'","'"$GEMINI_API_KEY_2"'"]' > keys.json
# then upload
wrangler kv:key put --namespace-id <namespace-id> "gemini_key_rotator:cooldown_data_v1" '{"keys":'$(cat keys.json)',"keyStatus":{}}'
```

4) Local development (`npm run dev`)

- Create `.dev.vars` with any secrets you need:

```bash
# .dev.vars
GEMINI_KEYS=sk-KEY1,sk-KEY2
OPENAI_API_KEY=sk-your-admin-key
```

- Run:

```bash
npm install
npm run dev
```

5) Remote deployment

- Add the KV binding id to [`wrangler.toml`](wrangler.toml:1)
- Set any secrets:

```bash
wrangler secret put OPENAI_API_KEY
# optionally set GEMINI_KEYS as a secret or in dashboard vars
```

- Deploy:

```bash
npm run deploy
```

6) Quick tests

- List models:

```bash
curl https://<your-worker>.workers.dev/v1/models
```

- Chat completion (non-streaming):

```bash
curl -X POST https://<your-worker>.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-admin-key" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'
```

- Streaming:

```bash
curl -N -X POST https://<your-worker>.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-admin-key" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Stream test"}],"stream":true}'
```

Note: this fork enables automatic fallback from `gemini-2.5-pro` to `gemini-2.5-flash` by default. The switch is seamless and works together with the key rotation/rotator so that when a rate limit occurs the worker will retry the request with the fallback model and continue returning content to the client. To opt out, set the `ENABLE_AUTO_MODEL_SWITCHING` secret to the string "false".

7) Mapping from old repo

- Old app used token caching and per-key secrets (see `baseREADME (1).md`) — this fork centralizes rotator state in KV.
- Files you will interact with:

- [`wrangler.toml`](wrangler.toml:1)
- [`src/routes/openai.ts`](src/routes/openai.ts:1)
- [`src/key-manager.ts`](src/key-manager.ts:1)
- [`src/key-rotator.ts`](src/key-rotator.ts:1)
- [`src/usage-tracker.ts`](src/usage-tracker.ts:1)

8) Troubleshooting

- 401 Unauthorized: ensure OPENAI_API_KEY (worker auth) or request header present.
- KV not found / binding error: confirm the id in [`wrangler.toml`](wrangler.toml:1) matches the created namespace.
- Empty responses / rate limit: check the KV cooldown payload and logs.

Useful debug endpoints:

- [`/v1/debug/cache`](src/routes/openai.ts:1)
- [`/v1/test`](src/routes/openai.ts:1)

9) Revert plan

- If you want to revert to the original gemini-cli-openai deployment, restore your old `wrangler.toml` and secrets and re-deploy.

10) Notes & security

- Do NOT commit real API keys into the repository. Use secrets or Cloudflare dashboard.
- KV is persistent but readable by your worker; treat keys as sensitive.

Contact

For migration help, paste errors or logs and I will produce targeted fixes.