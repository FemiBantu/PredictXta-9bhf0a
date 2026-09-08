#!/usr/bin/env node
/**
 * validate-firebase-credentials.js
 *
 * Phase 3 pre-build credential validator.
 * Run before EAS build to confirm real (non-placeholder) credentials.
 *
 * Usage:
 *   node scripts/validate-firebase-credentials.js
 *   node scripts/validate-firebase-credentials.js --strict   # exits 1 on any error
 *
 * In CI: called by deploy.yml "Phase 3 credential audit" step.
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const STRICT  = process.argv.includes('--strict');

let errors   = 0;
let warnings = 0;

function ok(msg)   { console.log(`  ✅  ${msg}`); }
function warn(msg) { console.warn(`  ⚠️   ${msg}`); warnings++; }
function fail(msg) { console.error(`  ❌  ${msg}`); errors++; }

// ─── google-services.json ────────────────────────────────────────────────────
console.log('\n── google-services.json ─────────────────────────────────────────');
const androidPath = path.join(ROOT, 'google-services.json');
if (!fs.existsSync(androidPath)) {
  fail('google-services.json not found at project root');
} else {
  let gsf;
  try { gsf = JSON.parse(fs.readFileSync(androidPath, 'utf8')); } catch (e) {
    fail(`google-services.json is not valid JSON: ${e.message}`);
    gsf = null;
  }

  if (gsf) {
    const pkg = gsf?.client?.[0]?.client_info?.android_client_info?.package_name;
    if (pkg !== 'com.predictxta.sports') {
      fail(`package_name is "${pkg}" — expected "com.predictxta.sports"`);
    } else { ok(`package_name: ${pkg}`); }

    const apiKey = gsf?.client?.[0]?.api_key?.[0]?.current_key ?? '';
    if (!apiKey || apiKey.includes('YOUR_') || apiKey.length < 20) {
      fail(`api_key is placeholder or missing: "${apiKey}"`);
    } else { ok('api_key: real value present'); }

    // Check for at least one non-placeholder OAuth client
    const oauthClients = gsf?.client?.[0]?.oauth_client ?? [];
    const realClients = oauthClients.filter(
      c => c.client_id && !c.client_id.includes('YOUR_') && c.client_id.endsWith('.apps.googleusercontent.com')
    );
    if (realClients.length === 0) {
      fail('No real OAuth client_id found — placeholder values detected');
    } else { ok(`OAuth clients: ${realClients.length} real client(s) found`); }

    // Ensure has_comment / _comment fields are not the only content
    if (gsf._comment) {
      warn('google-services.json still contains _comment field — replace with real file from Firebase Console');
    }
  }
}

// ─── GoogleService-Info.plist ────────────────────────────────────────────────
console.log('\n── GoogleService-Info.plist ─────────────────────────────────────');
const iosPlistPath = path.join(ROOT, 'GoogleService-Info.plist');
if (!fs.existsSync(iosPlistPath)) {
  fail('GoogleService-Info.plist not found at project root');
} else {
  const content = fs.readFileSync(iosPlistPath, 'utf8');

  // Extract key values from plist XML (simple regex for known keys)
  const extract = (key) => {
    const m = content.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    return m ? m[1] : null;
  };

  const bundleId   = extract('BUNDLE_ID');
  const clientId   = extract('CLIENT_ID');
  const apiKey     = extract('API_KEY');
  const reversedId = extract('REVERSED_CLIENT_ID');

  if (bundleId !== 'com.predictxta.sports') {
    fail(`BUNDLE_ID is "${bundleId}" — expected "com.predictxta.sports"`);
  } else { ok(`BUNDLE_ID: ${bundleId}`); }

  if (!clientId || clientId.includes('YOUR_')) {
    fail(`CLIENT_ID is placeholder: "${clientId}"`);
  } else { ok('CLIENT_ID: real value present'); }

  if (!apiKey || apiKey.includes('YOUR_')) {
    fail(`API_KEY is placeholder: "${apiKey}"`);
  } else { ok('API_KEY: real value present'); }

  if (!reversedId || reversedId.includes('YOUR_')) {
    warn(`REVERSED_CLIENT_ID appears to be placeholder: "${reversedId}" — required for Google Sign-In URL scheme`);
  } else { ok('REVERSED_CLIENT_ID: present'); }

  // Warn if placeholder comment is still in file (means it hasn't been replaced)
  if (content.includes('PLACEHOLDER') || content.includes('YOUR_IOS_CLIENT_ID')) {
    warn('GoogleService-Info.plist still contains placeholder markers — replace with real file from Firebase Console');
  }
}

// ─── app.json EAS project ID ─────────────────────────────────────────────────
console.log('\n── app.json EAS configuration ───────────────────────────────────');
const appJsonPath = path.join(ROOT, 'app.json');
if (fs.existsSync(appJsonPath)) {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const projectId = appJson?.expo?.extra?.eas?.projectId;
  const updatesUrl = appJson?.expo?.updates?.url;

  // Valid EAS project IDs are UUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!projectId || !UUID_RE.test(projectId)) {
    fail(`extra.eas.projectId "${projectId}" is not a valid UUID — run: eas project:info`);
  } else { ok(`EAS projectId: ${projectId}`); }

  if (!updatesUrl || updatesUrl.includes('YOUR_') || !updatesUrl.includes(projectId ?? '')) {
    warn(`updates.url "${updatesUrl}" may not match projectId — update after confirming EAS project`);
  } else { ok(`updates.url: ${updatesUrl}`); }

  // Verify Firebase credential file references
  const androidGSF = appJson?.expo?.android?.googleServicesFile;
  const iosGSF     = appJson?.expo?.ios?.googleServicesFile;

  if (androidGSF !== './google-services.json') {
    fail(`android.googleServicesFile is "${androidGSF}" — expected "./google-services.json"`);
  } else { ok(`android.googleServicesFile: ${androidGSF}`); }

  if (iosGSF !== './GoogleService-Info.plist') {
    fail(`ios.googleServicesFile is "${iosGSF}" — expected "./GoogleService-Info.plist"`);
  } else { ok(`ios.googleServicesFile: ${iosGSF}`); }
}

// ─── eas.json build profile checks ───────────────────────────────────────────
console.log('\n── eas.json build profiles ──────────────────────────────────────');
const easJsonPath = path.join(ROOT, 'eas.json');
if (fs.existsSync(easJsonPath)) {
  const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));

  const prodAndroid = easJson?.build?.production?.android?.googleServicesFile;
  const prodIos     = easJson?.build?.production?.ios?.googleServicesFile;

  if (prodAndroid !== '$GOOGLE_SERVICES_JSON') {
    fail(`production android.googleServicesFile is "${prodAndroid}" — expected "$GOOGLE_SERVICES_JSON"`);
  } else { ok('production android: uses $GOOGLE_SERVICES_JSON EAS secret'); }

  if (prodIos !== '$GOOGLE_SERVICES_PLIST') {
    fail(`production ios.googleServicesFile is "${prodIos}" — expected "$GOOGLE_SERVICES_PLIST"`);
  } else { ok('production iOS: uses $GOOGLE_SERVICES_PLIST EAS secret'); }

  // Development profile should use local file
  const devAndroid = easJson?.build?.development?.android?.googleServicesFile;
  if (devAndroid !== './google-services.json') {
    warn(`development android.googleServicesFile is "${devAndroid}" — expected "./google-services.json"`);
  } else { ok('development android: uses local ./google-services.json'); }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────────────');
if (errors === 0 && warnings === 0) {
  console.log('✅  All Phase 3 credential checks passed — ready for EAS build\n');
  process.exit(0);
} else if (errors === 0) {
  console.log(`⚠️   ${warnings} warning(s), 0 errors — proceeding with caution\n`);
  process.exit(STRICT ? 1 : 0);
} else {
  console.error(`❌  ${errors} error(s), ${warnings} warning(s) — resolve before EAS build\n`);
  process.exit(1);
}
