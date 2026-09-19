# Android App Links — assetlinks.json

`web/.well-known/assetlinks.json` enables **Android Verified App Links** for `predictxta.app`.
This allows `https://predictxta.app/auth/callback` and `https://predictxta.app/reset-password`
to open directly in the app without the system disambiguator dialog — required for reliable
Google OAuth on Android.

---

## How to get the SHA-256 fingerprint

### Option A — EAS-managed keystore (recommended)

After your first `eas build --platform android --profile production`:

```bash
eas credentials --platform android
# Output includes:
#   Keystore details
#   MD5:    XX:XX:...
#   SHA1:   XX:XX:...
#   SHA256: XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
```

Copy the **SHA256** value (colon-separated hex) and paste it into
`web/.well-known/assetlinks.json` replacing `REPLACE_WITH_PRODUCTION_SHA256`.

### Option B — local/custom keystore

```bash
keytool -list -v \
  -keystore your-release-key.jks \
  -alias your-key-alias
# Look for: SHA256: XX:XX:...
```

### Option C — from a built APK

```bash
# Extract META-INF/CERT.RSA then:
keytool -printcert -file CERT.RSA
# SHA256 is printed in the output
```

---

## Deploy requirement

`assetlinks.json` **must be served** at:

```
https://predictxta.app/.well-known/assetlinks.json
```

With headers:
```
Content-Type: application/json
Access-Control-Allow-Origin: *
```

### Cloudflare Worker (px-gateway) — add a route

In `cloudflare/workers/px-gateway.ts`, ensure requests to `/.well-known/assetlinks.json`
are served from this static file (or pass through to the origin static export).

The Expo `web/` directory is included in `expo export --platform web`, so the file will be
at `dist/.well-known/assetlinks.json` after build. The `serve` runtime in Docker serves
everything under `dist/` at the root, so the file is automatically available.

Verify after deployment:
```bash
curl https://predictxta.app/.well-known/assetlinks.json
# Should return the JSON content with HTTP 200
```

---

## Google verification tool

```
https://digitalassetlinks.googleapis.com/v1/statements:list
  ?source.web.site=https://predictxta.app
  &relation=delegate_permission/common.handle_all_urls
```

Or use the **Android App Links Assistant** in Android Studio:
Tools → App Links Assistant → Open Digital Asset Links File Generator

---

## app.json — HTTPS intent filters added

The following verified App Link filters were added to `app.json` with `autoVerify: true`:

| Filter | Path | Purpose |
|--------|------|---------|
| `https://predictxta.app/auth/callback` (pathPrefix) | `/auth/callback*` | Google OAuth PKCE callback |
| `https://predictxta.app/auth/callback` (exact path) | `/auth/callback` | Google OAuth exact match |
| `https://predictxta.app/reset-password` (pathPrefix) | `/reset-password*` | Password reset deep link |

> **Note:** `autoVerify: true` only functions on `scheme: "https"` filters.
> The existing `predictxta://` custom-scheme filters retain `autoVerify: false`
> (autoVerify on custom schemes is a no-op and not required).

---

## Checklist

- [ ] `eas build --platform android --profile production` (first build)
- [ ] Copy SHA-256 from `eas credentials --platform android`
- [ ] Update `web/.well-known/assetlinks.json` with real fingerprint
- [ ] Deploy to production (`https://predictxta.app/.well-known/assetlinks.json` returns 200)
- [ ] Verify with `digitalassetlinks.googleapis.com` API
- [ ] Add production SHA-256 to Firebase Console → Project Settings → Android app
- [ ] Add production SHA-256 to Google Cloud Console → OAuth 2.0 Android client
- [ ] **Add `https://predictxta.app/auth/callback` to Supabase Dashboard → Auth → URL Configuration → Redirect URLs**
- [ ] **Add `https://predictxta.app/auth/callback` to Google Cloud Console → Credentials → Web client → Authorized redirect URIs**
- [ ] Test Google Sign-In on a production APK — should open app directly, no browser dialog
