# CHANGELOG

This changelog documents notable changes introduced in the `gemini-loadbalance-rotator-worker` fork compared to the original `gemini-cli-openai` project. It explains design decisions, breaking changes, operational differences, and migration steps for users upgrading from the upstream project.

Acknowledgements
- This fork was developed using work from https://github.com/kevinyuan/gemini-loadbalance-worker as the immediate codebase used to create this fork; thank you to Kevin Yuan for the groundwork. The upstream project `gemini-cli-openai` (https://github.com/GewoonJaap/gemini-cli-openai) is also acknowledged.

## Unreleased

### Summary
- Introduced multi-key load balancing and rotation for Gemini OAuth credentials.
- Added per-key project ID support and per-key error/cooldown management.
- Added optional Cloudflare KV support for persistent rotator state and usage tracking.
- Improved operational resilience: keys that repeatedly fail are temporarily disabled and auto-recovered after cooldown.
- Added documentation and tooling for migrating from the upstream project.

### Detailed changes

1) Multi-key rotator
- What: The worker can now accept multiple Gemini OAuth credential JSONs and distribute requests across them.
- Why: Spread quota and minimize single-account rate limits.
- Files: `src/key-rotator.ts`, `src/key-manager.ts`, `src/usage-tracker.ts`.

2) Per-key project_id
- What: Each input credential may include a `project_id` field. The Gemini client will use this value when making requests, allowing multiple Google Cloud projects to be used simultaneously.
- Why: Useful if you have separate billing or quotas per project.
- Impact: If you relied on a single `GEMINI_PROJECT_ID` global var upstream, you can either keep using it or embed `project_id` in each credential.

3) Error counting and cooldowns
- What: Each key tracks consecutive errors. After `MAX_ERROR_COUNT` consecutive failures, the key is marked invalid and excluded from rotation for a cooldown window (default 1 hour).
- Why: Prevents repeated retries against a misbehaving credential and helps maintain healthy rotation.
- Files: `src/usage-tracker.ts`, `src/key-rotator.ts`.

4) KV-backed rotator state (optional)
- What: Rotator state (cooldown lists, usage stats) can be stored in Cloudflare KV. This gives persistence across worker restarts and deployments.
- Why: Ensures rotation state is durable for multi-instance deployments.
- How to use: Create a KV namespace and bind it in `wrangler.toml` as described in `README_MIGRATION.md`.

5) Secrets handling
- What: The fork supports the upstream `GEMINI_API_KEY_*` secrets format but also accepts `GEMINI_KEYS` and KV payloads. The recommended approach is to use per-key secrets or KV entries for production.
- Why: Flexibility for migration while encouraging secure secret management.

6) API compatibility
- What: The OpenAI-compatible endpoints are preserved. The worker converts Gemini responses (including thinking streams) to OpenAI-style SSE chunks.
- Potential differences: You may notice differences in rate-handling when multiple keys are active, and fallback behavior when `ENABLE_AUTO_MODEL_SWITCHING` is enabled.

### Breaking changes & migration notes

- Upstream deployments that relied on a single in-repo token cache should move to either providing multiple `GEMINI_API_KEY_*` secrets or seeding the rotator KV keys. See `README_MIGRATION.md` for step-by-step instructions.
- If you used a global `GEMINI_PROJECT_ID` before but now supply per-key project IDs, ensure there are no mismatches in project permissions for each key.
- KV namespace binding name (expected in `wrangler.toml`) is `GEMINI_CLI_LOADBALANCE` by default for rotator state. If you previously used `GEMINI_CLI_KV`, update accordingly or adjust the code/config.

### Security notes

- Do not commit OAuth credentials to source control. Use `wrangler secret put` and/or Cloudflare KV for production.
- Keys in KV are readable by the worker; treat the KV namespace as sensitive and restrict access to your Cloudflare account.

### How to roll back

1. If you previously had an upstream deployment, keep a copy of your old `wrangler.toml` and secrets.
2. Remove any rotator-related KV keys or restore previous KV entries.
3. Re-deploy the upstream code or re-configure to use a single `GEMINI_API_KEY_*` secret.

## 2025-09-09 - Initial public fork release

- See `Unreleased` for the current feature set.
- This entry marks the initial release of the fork and documents the migration guidance.

---

If you'd like, I can extend the changelog with a structured format (Keep a Changelog style), or add a `RELEASES.md` with example release notes for semantic versioning.
