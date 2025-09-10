#!/usr/bin/env node
/**
 * push-oauth-secrets.js
 *
 * Usage:
 *  node ./scripts/push-oauth-secrets.js           # dry-run by default
 *  node ./scripts/push-oauth-secrets.js --run     # actually run wrangler secret put
 *  node ./scripts/push-oauth-secrets.js --start 3 # start numbering at 3
 *
 * Reads all .json files in ./oauth creds/ (alphabetical), and for each
 * file writes a Wrangler secret named GEMINI_API_KEY_<N> where N starts at 1
 * (or --start). If --run is not provided the script only prints the commands
 * it would run.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OAUTH_DIR = path.join(__dirname, '..', 'oauth creds');
const argv = process.argv.slice(2);
const doRun = argv.includes('--run');
const startIndexArg = (() => {
  const idx = argv.indexOf('--start');
  if (idx !== -1 && argv[idx+1]) return parseInt(argv[idx+1], 10) || 1;
  return 1;
})();

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.json'))
    .sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function main() {
  const files = listJsonFiles(OAUTH_DIR);
  if (files.length === 0) {
    console.error('No .json credential files found in', OAUTH_DIR);
    process.exit(2);
  }

  console.log(`Found ${files.length} credential files in '${OAUTH_DIR}'.`);
  let n = Math.max(1, startIndexArg);

  for (const file of files) {
    const filePath = path.join(OAUTH_DIR, file);
    const secretName = `GEMINI_API_KEY_${n}`;
    const content = fs.readFileSync(filePath, 'utf8');

    console.log(`\n[${n}] ${file} -> ${secretName}`);
    if (!doRun) {
      console.log(`DRY RUN: will run: Get-Content -Raw "${filePath}" | wrangler secret put ${secretName}`);
    } else {
      console.log(`Running: wrangler secret put ${secretName} (piping file content)`);
      try {
        const ps = spawnSync('wrangler', ['secret', 'put', secretName], {
          input: Buffer.from(content, 'utf8'),
          stdio: ['pipe', 'inherit', 'inherit'],
          shell: true
        });
        if (ps.error) throw ps.error;
        if (ps.status !== 0) {
          console.error(`Failed to set secret ${secretName} (exit ${ps.status}).`);
        } else {
          console.log(`Set secret ${secretName} successfully.`);
        }
      } catch (err) {
        console.error(`Error setting secret ${secretName}:`, err && err.message ? err.message : err);
      }
    }

    n++;
  }

  console.log('\nCompleted.');
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
