#!/usr/bin/env node
/**
 * scripts/typecheck.js
 *
 * Standalone TypeScript type-check runner.
 *
 * WHY THIS EXISTS:
 *   package.json is a restricted file and cannot be edited by this tool.
 *   This script provides a `typecheck` command until package.json gains a
 *   "typecheck": "tsc --noEmit" script entry.
 *
 * USAGE:
 *   node scripts/typecheck.js          # Run type check
 *   node scripts/typecheck.js --watch  # Watch mode
 *
 * When package.json is unlocked, add this to scripts:
 *   "typecheck": "tsc --noEmit",
 *   "typecheck:watch": "tsc --noEmit --watch",
 *   "lint": "eslint . --ext .ts,.tsx",
 */

'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

// ── Verify tsconfig.json exists ───────────────────────────────────────────────
if (!fs.existsSync(tsconfigPath)) {
  console.error('ERROR: tsconfig.json not found at', tsconfigPath);
  process.exit(1);
}

const watchMode = process.argv.includes('--watch') || process.argv.includes('-w');
const strict    = process.argv.includes('--strict');

// ── Find tsc binary ───────────────────────────────────────────────────────────
function findTsc() {
  const localTsc = path.join(projectRoot, 'node_modules', '.bin', 'tsc');
  if (fs.existsSync(localTsc)) return localTsc;

  // pnpm symlink may be in .pnpm/.bin
  const pnpmBin = path.join(projectRoot, 'node_modules', '.pnpm', '.bin', 'tsc');
  if (fs.existsSync(pnpmBin)) return pnpmBin;

  // Fall back to global tsc
  try {
    execSync('tsc --version', { stdio: 'ignore' });
    return 'tsc';
  } catch {
    console.error('ERROR: TypeScript (tsc) not found. Run: pnpm install');
    process.exit(1);
  }
}

const tscBin = findTsc();

const args = ['--noEmit'];
if (watchMode) args.push('--watch');
if (strict)    args.push('--strict');

console.log(`[typecheck] Running: ${path.relative(projectRoot, tscBin)} ${args.join(' ')}`);
console.log('[typecheck] Project:', tsconfigPath);
console.log('');

const proc = spawn(tscBin, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

proc.on('close', (code) => {
  if (code === 0) {
    console.log('\n[typecheck] ✓ No type errors found');
  } else {
    console.error(`\n[typecheck] ✗ TypeScript errors found (exit code ${code})`);
  }
  process.exit(code ?? 1);
});

proc.on('error', (err) => {
  console.error('[typecheck] Failed to start tsc:', err.message);
  process.exit(1);
});
