# gemini-loadbalance-rotator-worker

Public repository: https://github.com/soficis/gemini-loadbalance-rotator-worker

This repository is a fork and enhancement of upstream projects that expose OpenAI-compatible endpoints while proxying requests to Google's Gemini models. The primary addition in this fork is robust OAuth credential rotation (multiple per-key OAuth JSON credentials) and operational improvements for production use.

Acknowledgements
- Based on and inspired by:
    - https://github.com/kevinyuan/gemini-loadbalance-worker — thank you Kevin Yuan for the load-balance design.
    - https://github.com/GewoonJaap/gemini-cli-openai — thank you for the core OpenAI-compatibility approach.

Main additions in this fork
- Per-key OAuth rotation (store multiple `GEMINI_API_KEY_n` secrets where each value is a full OAuth credential JSON).
- KV-backed token cache and per-key cooldown/invalidations on repeated errors.
- Automatic model fallback (e.g. `gemini-2.5-pro` → `gemini-2.5-flash`) is enabled by default and works seamlessly with key rotation; set `ENABLE_AUTO_MODEL_SWITCHING` to "false" to opt-out.

Quick start (noob-friendly)

1) Clone the repo and install dependencies

```powershell
git clone https://github.com/soficis/gemini-loadbalance-rotator-worker.git
cd gemini-loadbalance-rotator-worker
npm install
```

2) Prepare your Gemini OAuth credential JSON files

Each credential must be the full OAuth JSON object you get from the Gemini CLI (or Google Cloud OAuth flow). Example fields include: `access_token`, `refresh_token`, `expiry_date`, and `project_id`.

- Recommended local layout: create a folder named `oauth creds/` (this folder is in `.gitignore`). Place one JSON file per credential, e.g. `oauth_creds.json`, `random1-oauth_creds.json`, etc.

3) Upload credentials as Cloudflare secrets (production)

Use `wrangler secret put` to upload each file as `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc. Example (PowerShell):

```powershell
Get-Content -Raw "./oauth creds/oauth_creds.json" | wrangler secret put GEMINI_API_KEY_1
Get-Content -Raw "./oauth creds/random1-oauth_creds.json" | wrangler secret put GEMINI_API_KEY_2

Automated helper: push-oauth-secrets script
-----------------------------------------

This repository includes `scripts/push-oauth-secrets.js` which automates pushing all JSON files under `oauth creds/` to sequential Cloudflare secrets named `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.

- Dry-run (safe):

```powershell
npm run push-secrets
```

- Execute (actually pushes secrets):

```powershell
npm run push-secrets:run
```

Security reminder
-----------------

- Ensure `oauth creds/` remains gitignored and do not commit per-credential JSON files.
- If you used the local `.dev.vars` during development, delete it before publishing and remove it from git history if it was committed.
- Prefer Cloudflare secrets (`wrangler secret put`) over embedding secrets in `wrangler.toml`.
```

4) Optional: import local `.dev.vars` for development

You can use the included `scripts/import-keys.js` to bulk-import a `.dev.vars` file for local dev. See `USAGE.md` for a step-by-step guide.

5) Run locally (PowerShell)

```powershell
node ./scripts/import-keys.js; Get-Content .dev.vars | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { $n=$matches[1]; $v=$matches[2].Trim("'\""); Set-Item -Path Env:$n -Value $v } }; npm run dev
```

6) Deploy to Cloudflare

Ensure `wrangler.toml` has a KV namespace entry for `GEMINI_CLI_LOADBALANCE` (used by token cache and rotator state), then:

```bash
npm run build
npm run deploy
```

Detailed differences vs upstream

- Upstream `gemini-cli-openai` focused on a single credential and compatibility layer. This fork adds multi-key rotation and operational state in KV.
- Upstream `gemini-loadbalance-worker` (Kevin Yuan) provided load-balancing ideas; this fork makes rotation safer for OAuth credentials and provides per-key project IDs and cooldowns.

How to obtain Gemini OAuth credential JSONs

1) Use the Gemini CLI or Google Cloud console to create an OAuth client and obtain credentials.
2) Authorize the client to access the Cloud Code / Gemini APIs and capture the JSON credential (access_token, refresh_token, expiry_date, project_id).
3) Save the JSON object as a file and upload with `wrangler secret put`.

See `USAGE.md` for detailed step-by-step instructions and troubleshooting tips for newcomers.

Security
- Do not commit OAuth JSON files or `.dev.vars`. These are added in `.gitignore`.
- Use `wrangler secret put` for production credentials and rotate them regularly.

Publishing checklist
- Ensure `.gitignore` includes any local credential files and logs (it does).
- Remove any temporary debug logging and run `npm run lint` and `npx tsc --noEmit` before publishing.

If you want an expanded publish-ready README with diagrams or templates, tell me which sections to expand.
