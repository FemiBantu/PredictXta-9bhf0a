#!/usr/bin/env node
/**
 * scripts/reset-project.js
 *
 * ⚠️  SECURITY REMEDIATION — credentials removed 2026-09-19
 *
 * A GitHub personal access token (ghp_*) was previously embedded in this
 * file inside a GitHub API URL. That token has been REMOVED from this file.
 *
 * Required manual steps (owner must complete immediately):
 *   1. Revoke the exposed token at https://github.com/settings/tokens
 *   2. Review GitHub security log: https://github.com/settings/security-log
 *   3. Rewrite Git history to expunge the token from all commits:
 *        git filter-repo --path scripts/reset-project.js --invert-paths
 *      OR redact just the token string:
 *        git filter-repo --replace-text <(echo 'ghp_EXPOSED_TOKEN==>REDACTED')
 *   4. Force-push the rewritten history and rotate any secrets that were
 *      accessible via the exposed token.
 *   5. If the token had repo write/admin scope, treat the repository as
 *      potentially compromised and audit all recent commits/workflow runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POLICY: Credentials MUST be stored in:
 *   - EAS Secrets (for EAS build environment variables)
 *   - GitHub Actions secrets (Settings → Secrets → Actions)
 *   - .env (local only, never committed — listed in .gitignore)
 *   - Supabase Secrets (Edge Function env vars via dashboard)
 *
 * NEVER embed tokens, API keys, or passwords in source files.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This script's original purpose was to reset the Expo project template.
 * If you need that functionality, re-implement it using environment variables:
 *
 *   const token = process.env.GITHUB_TOKEN;
 *   if (!token) throw new Error('GITHUB_TOKEN env var required — do not hardcode');
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ─── Credential safety check ──────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

if (!GITHUB_TOKEN) {
  console.error(
    '\n[reset-project] ERROR: GITHUB_TOKEN environment variable is not set.\n' +
    'Set it before running this script:\n' +
    '  export GITHUB_TOKEN=ghp_your_token_here  # shell session only\n' +
    '  # OR pass it inline:\n' +
    '  GITHUB_TOKEN=ghp_your_token_here node scripts/reset-project.js\n\n' +
    'NEVER hardcode a token in this file.\n',
  );
  process.exit(1);
}

// Basic token format sanity check (does not validate against GitHub API)
if (!GITHUB_TOKEN.startsWith('ghp_') && !GITHUB_TOKEN.startsWith('github_pat_')) {
  console.warn(
    '[reset-project] WARNING: GITHUB_TOKEN does not look like a classic PAT (ghp_) ' +
    'or fine-grained PAT (github_pat_). Proceeding anyway.',
  );
}

console.log('[reset-project] Token loaded from environment — NOT from source file. ✓');

/**
 * makeGitHubRequest — thin wrapper around the GitHub REST API.
 * Uses the token from the environment variable exclusively.
 *
 * @param {string} apiPath   - e.g. '/repos/owner/repo/contents/path'
 * @param {string} method    - HTTP method (default 'GET')
 * @param {object} body      - Request body for POST/PUT/PATCH
 * @returns {Promise<object>}
 */
function makeGitHubRequest(apiPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'predictxta-reset-script/1.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * resetProjectTemplate — main entry point.
 * Add your actual reset logic here, using makeGitHubRequest() instead of
 * embedding the token in URLs.
 */
async function resetProjectTemplate() {
  console.log('[reset-project] Starting project reset...');

  // Example: list repository contents (replace with actual reset logic)
  // const result = await makeGitHubRequest('/repos/YOUR_ORG/YOUR_REPO/contents');
  // console.log('[reset-project] API response status:', result.status);

  console.log('[reset-project] Done.');
}

// ─── Run ─────────────────────────────────────────────────────────────────────
resetProjectTemplate().catch((err) => {
  console.error('[reset-project] Fatal error:', err.message);
  process.exit(1);
});

module.exports = { makeGitHubRequest, resetProjectTemplate };
