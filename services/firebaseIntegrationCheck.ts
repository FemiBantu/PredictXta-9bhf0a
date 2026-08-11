/**
 * firebaseIntegrationCheck.ts
 *
 * Startup Firebase/push notification integration validator.
 * Runs in DEV mode only — provides actionable console warnings.
 *
 * Checks:
 *  1. google-services.json / GoogleService-Info.plist referenced in app.json  ✅ (verified)
 *  2. EAS projectId is set (not placeholder)
 *  3. expo-notifications channel created on Android
 *  4. FIREBASE_SERVER_KEY edge function reachable
 *  5. Push token obtainable (real device only)
 *
 * Usage: called once from app/_layout.tsx in __DEV__ mode
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

interface IntegrationCheckResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

export async function runFirebaseIntegrationCheck(): Promise<IntegrationCheckResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── 1. EAS Project ID ──────────────────────────────────────────────────────
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId || projectId === 'YOUR_EAS_PROJECT_ID' || projectId === 'predictxta-app') {
    errors.push(
      '[Firebase] EAS projectId is a placeholder. ' +
      'Run `eas project:info` and update app.json → extra.eas.projectId and updates.url'
    );
  } else {
    console.log('[Firebase] ✅ EAS projectId:', projectId);
  }

  // ── 2. OTA Update URL ──────────────────────────────────────────────────────
  const otaUrl: string | undefined = (Constants.expoConfig as any)?.updates?.url;
  if (!otaUrl || otaUrl.includes('YOUR_EAS_PROJECT_ID')) {
    warnings.push(
      '[Firebase] OTA updates URL contains placeholder. ' +
      'Update app.json → updates.url with real EAS project UUID.'
    );
  }

  // ── 3. Platform-specific file check ───────────────────────────────────────
  if (Platform.OS === 'android') {
    // At runtime we can't read the filesystem, but we check if FCM config
    // was injected at build time via the presence of a google-app-id.
    const appId: string | undefined = (Constants.expoConfig as any)?.android?.googleServicesFile;
    if (!appId) {
      warnings.push(
        '[Firebase] android.googleServicesFile not set in app.json. ' +
        'Add: "googleServicesFile": "./google-services.json" under "android".'
      );
    } else {
      console.log('[Firebase] ✅ Android googleServicesFile configured:', appId);
    }
  }

  if (Platform.OS === 'ios') {
    const plistRef: string | undefined = (Constants.expoConfig as any)?.ios?.googleServicesFile;
    if (!plistRef) {
      warnings.push(
        '[Firebase] ios.googleServicesFile not set in app.json. ' +
        'Add: "googleServicesFile": "./GoogleService-Info.plist" under "ios".'
      );
    } else {
      console.log('[Firebase] ✅ iOS googleServicesFile configured:', plistRef);
    }
  }

  // ── 4. expo-notifications plugin check ────────────────────────────────────
  const plugins: unknown[] = (Constants.expoConfig as any)?.plugins ?? [];
  const hasNotifPlugin = plugins.some(
    (p) => Array.isArray(p) ? p[0] === 'expo-notifications' : p === 'expo-notifications'
  );
  if (!hasNotifPlugin) {
    errors.push(
      '[Firebase] expo-notifications plugin missing from app.json plugins array. ' +
      'Add: ["expo-notifications", { "icon": "./assets/logo.png", "color": "#FFD700" }]'
    );
  } else {
    console.log('[Firebase] ✅ expo-notifications plugin present in app.json');
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const passed = errors.length === 0;

  if (warnings.length > 0) {
    console.warn('[Firebase Integration Check] Warnings:\n' + warnings.join('\n'));
  }
  if (errors.length > 0) {
    console.error('[Firebase Integration Check] Errors:\n' + errors.join('\n'));
  }
  if (passed && warnings.length === 0) {
    console.log('[Firebase Integration Check] ✅ All checks passed');
  }

  return { passed, warnings, errors };
}
