# Security Incident Report — Exposed GitHub Token

**Date detected:** 2026-09-19  
**Severity:** P0 — Critical  
**Status:** Code remediated. Manual steps required (see below).

---

## What happened

A GitHub personal access token (`ghp_*`) was embedded directly inside  
`scripts/reset-project.js` in a GitHub API URL.

### Scope of exposure

| Question | Answer |
|---|---|
| Token type | GitHub Classic PAT (`ghp_*`) |
| Exposed in | `scripts/reset-project.js` — static source file |
| Git history | Yes — every commit since the file was created contains the token |
| Runtime usage | Script was called manually or from CI; not served to end users |
| Related secrets potentially accessible | Depends on the token's granted scopes (repo, workflow, admin:org, etc.) |

---

## Immediate actions taken (automated)

- [x] Token string removed from `scripts/reset-project.js`  
- [x] Script rewritten to read token from `GITHUB_TOKEN` environment variable only  
- [x] No other source files contain `ghp_*` patterns (full repo scan confirmed)

---

## Required manual actions (owner must complete)

### 1 — Revoke the token NOW

1. Go to **https://github.com/settings/tokens**
2. Find the token that starts with `ghp_` (check creation date matches when the file was added)
3. Click **Delete / Revoke**
4. Confirm revocation

**Do this before anything else.** A revoked token cannot be used even if the Git history is not yet cleaned.

### 2 — Review GitHub security and audit logs

- **Personal security log:** https://github.com/settings/security-log  
  Filter by `authentication` and `token` to see if the token was used by any unexpected actor.

- **Repository audit log (org):** `https://github.com/organizations/YOUR_ORG/settings/audit-log`  
  Look for unexpected pushes, workflow triggers, or API calls made with the token.

- **GitHub Actions workflow runs:** Check for any workflow runs triggered from unexpected branches or forks that may have read the token from the source file.

### 3 — Rewrite Git history to expunge the token

The token exists in every historical commit that included this file. After revoking the token, rewrite history so the value cannot be recovered from older commits:

**Option A — git-filter-repo (recommended):**
```bash
# Install: pip install git-filter-repo
# Replace the exact token string in all historical commits:
git filter-repo --replace-text <(printf 'ghp_YOUREXPOSEDTOKEN==>REDACTED_TOKEN\n')
git push --force --all
git push --force --tags
```

**Option B — BFG Repo-Cleaner:**
```bash
echo 'ghp_YOUREXPOSEDTOKEN' > secrets.txt
java -jar bfg.jar --replace-text secrets.txt --no-blob-protection .
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --all
```

> ⚠️ Force-push rewrites public history. Coordinate with all collaborators who have local clones — they must `git fetch --all && git reset --hard origin/main` after the rewrite.

### 4 — Rotate any resources the token could access

Depending on the token's scopes, audit and rotate:

| Scope | Action |
|---|---|
| `repo` | Review all pushes / branch creations / deletions in the repo audit log |
| `workflow` | Review all GitHub Actions runs; rotate `ACTIONS_RUNNER_TOKEN` if applicable |
| `admin:org` | Review org membership and team changes |
| `packages` | Review package publish history |
| `secrets` (none — cannot read secrets via PAT) | No action needed for GitHub secrets |

### 5 — Create a replacement token (if needed)

If the script genuinely requires a GitHub API token:

1. Create a **fine-grained PAT** scoped to the minimum required permissions  
   (prefer repo-scoped, not org-wide)
2. Store it as a **GitHub Actions secret**: repo → Settings → Secrets → Actions → New secret  
   Name: `GITHUB_TOKEN_RESET` (do not use the reserved `GITHUB_TOKEN` name)
3. Reference it in the workflow: `${{ secrets.GITHUB_TOKEN_RESET }}`
4. For local use: `export GITHUB_TOKEN=ghp_newtoken && node scripts/reset-project.js`

**Never put the token value in any source file.**

---

## Root cause

Token was embedded directly in a hardcoded GitHub API URL string inside a utility script,  
rather than being read from an environment variable.

## Corrective controls added

1. `scripts/reset-project.js` now reads `GITHUB_TOKEN` from `process.env` exclusively  
2. Script exits with a clear error if the env var is not set  
3. Token format validation added as an additional guard  
4. This incident report documents the required remediation steps

## Prevention

- Add a pre-commit hook or CI step to detect credential patterns:
  ```bash
  # .github/workflows/secret-scan.yml step:
  - name: Secret scan
    uses: gitleaks/gitleaks-action@v2
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- Consider enabling **GitHub Secret Scanning** on the repository  
  (Settings → Security → Secret scanning → Enable)
- Enable **Push protection** to block future credential commits before they land
