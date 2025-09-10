USAGE — gemini-loadbalance-rotator-worker

This guide is written for users new to Cloudflare Workers, Wrangler, and Gemini OAuth. Follow these steps to get the project running locally and deployed.

1) Prerequisites
- Node.js (v18+ recommended)
- npm
- Wrangler CLI (install: `npm i -g wrangler`)
- A Cloudflare account and API token with permissions for Workers and Secrets
- (Optional) Gemini CLI or Google Cloud access to obtain OAuth credentials

2) Clone and install
```powershell
git clone https://github.com/soficis/gemini-loadbalance-rotator-worker.git
cd gemini-loadbalance-rotator-worker
npm install
```

3) Obtain OAuth credentials from Gemini CLI (short)
- The Gemini CLI typically provides an OAuth flow that returns a JSON credential object containing `access_token`, `refresh_token`, `expiry_date`, and `project_id`.
- Save each credential as a separate JSON file in a local folder (recommended name: `oauth creds/`). Example: `oauth creds/oauth_creds.json`.

Notes: if you don't have a Gemini CLI, follow the Google Cloud console OAuth client instructions to get a refresh token/client and perform an OAuth authorization flow to generate the credentials JSON.

4) Upload credentials to Cloudflare (production)
- Create a Cloudflare API token and export it to PowerShell for non-interactive runs:
```powershell
$env:CLOUDFLARE_API_TOKEN = 'YOUR_TOKEN'
```
- Upload each credential file as a secret:
```powershell
Get-Content -Raw "./oauth creds/oauth_creds.json" | wrangler secret put GEMINI_API_KEY_1
Get-Content -Raw "./oauth creds/random1-oauth_creds.json" | wrangler secret put GEMINI_API_KEY_2
```

5) Configure KV namespace for rotation state
- Create a KV namespace and copy the returned id into `wrangler.toml` under `kv_namespaces` with binding `GEMINI_CLI_LOADBALANCE`.

6) Automatic model switching (enabled by default)
- This project enables automatic fallback from `gemini-2.5-pro` to `gemini-2.5-flash` by default to provide a seamless experience with key rotation and rate-limit handling.

- To explicitly disable automatic switching, set the secret to the string "false":
```powershell
echo false | wrangler secret put ENABLE_AUTO_MODEL_SWITCHING
```

7) Run locally (dev)
- Use `.dev.vars` for local testing and the import script. Create `.dev.vars` with one `GEMINI_API_KEY_n` per line (value is the JSON string), then run:
```powershell
node ./scripts/import-keys.js; Get-Content .dev.vars | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { $n=$matches[1]; $v=$matches[2].Trim("'\""); Set-Item -Path Env:$n -Value $v } }; npm run dev
```

8) Deploy
```bash
npm run build
npm run deploy
```

9) Basic verification
- After deployment, make a request to `/v1/models` or `/v1/chat/completions`. Check worker logs for:
  - `Initialized N Gemini API clients in the pool...` (N is number of credentials you uploaded)
  - If enabled, `isEnabled:true` and fallback logs when a 429 occurs.

10) Troubleshooting
- If you see `Failed to parse JSON for env var GEMINI_API_KEY_n`, your secret is a raw API key or malformed JSON. Re-upload full OAuth JSON.
- If you see only 1 client initialized and you uploaded many creds, verify that each secret's content is valid JSON (no stray newlines or comment markers).
- If automatic fallback isn't happening, confirm `ENABLE_AUTO_MODEL_SWITCHING` is set to `true`.

11) Cleaning up before publishing
- Ensure `.gitignore` is present and includes `oauth creds/`, `.dev.vars`, and any local secrets before pushing to GitHub.

