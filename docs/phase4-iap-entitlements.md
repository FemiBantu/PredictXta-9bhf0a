# PredictXta — Phase 4: IAP, Subscriptions, Coins & Entitlements

Generated: 2026-09-08

---

## 1. IAP ARCHITECTURE OVERVIEW

```
Mobile App (native build)
  │
  ├── react-native-iap ──► StoreKit 2 (iOS)
  │                    ──► Google Play Billing v7 (Android)
  │
  │   On purchase event:
  │
  ├── iapService.grantVipEntitlement / grantCoins
  │     └── supabase.functions.invoke('verify-purchase', { body: receipt })
  │
  └── verify-purchase Edge Function
        ├── iOS:     App Store Server API (transactionId + ES256 JWT)
        │            ↳ Fallback: legacy /verifyReceipt (APPLE_SHARED_SECRET)
        ├── Android: Google Play Developer API (service account RS256 JWT)
        ├── Idempotency check (user_id + product_id + token slice)
        ├── Audit log → purchase_audit_log
        ├── Grant: vip_subscriptions (service_role) or add_user_coins RPC
        └── Ledger: coin_transactions (immutable, INSERT-only from server)
```

### Why shims are correct

`metro.config.js` routes `react-native-iap` and `react-native-nitro-modules` to
no-op shims **only** for `platform === 'web'` and `platform === 'server'`.
Native Android and iOS builds resolve the real packages from the pnpm store.
`iapService.ts` uses lazy `require()` with `try/catch` so the app degrades
gracefully in environments where the native module is not linked (preview builds).
Production App Store / Play Store builds always receive the real native module.

---

## 2. CANONICAL PRODUCT CATALOG

| Product ID | Type | Store price (fallback) | Duration / Amount |
|------------|------|----------------------|-------------------|
| `predictxta_vip_monthly` | Auto-renewable subscription | $1.99/mo | 31 days |
| `predictxta_vip_6month` | Auto-renewable subscription | $8.39/6mo | 183 days |
| `predictxta_vip_yearly` | Auto-renewable subscription | $14.99/yr | 365 days |
| `predictxta_coins_500` | Consumable | $0.99 | 500 coins |
| `predictxta_coins_2500` | Consumable | $3.99 | 2500 coins |
| `predictxta_coins_5000` | Consumable | $6.99 | 5000 coins |

**Authoritative location**: `PRODUCT_DEFINITIONS` in `verify-purchase/index.ts`
**Client reference**: `PRODUCT_IDS` in `services/iapService.ts`

> ⚠️ Product IDs must be registered in App Store Connect and Google Play Console
> before any purchase can be initiated. See §5 and §6 for setup steps.

---

## 3. SERVER-SIDE VERIFICATION

### iOS — App Store Server API (preferred)
- Endpoint: `GET /inApps/v1/transactions/{transactionId}`
- Auth: ES256 JWT signed with App Store Connect API key
- Fallback: legacy `POST /verifyReceipt` (when `APPLE_ISSUER_ID` not configured)
- Handles: active, expired, revoked, sandbox vs production
- Sandbox detection: automatic retry on `api.storekit-sandbox.itunes.apple.com`

### Android — Google Play Developer API
- Subscriptions: `GET /purchases/subscriptions/{productId}/tokens/{purchaseToken}`
- Consumables: `GET /purchases/products/{productId}/tokens/{purchaseToken}`
- Auth: RS256 JWT grant → OAuth2 access token via service account
- Acknowledgement: auto-acknowledges unacknowledged purchases
- Handles: active, cancelled (still valid until expiry), expired, pending

### Verification status states
| Status | Action |
|--------|--------|
| `verified` | Grant entitlement immediately |
| `pending_verification` | Grant entitlement (credentials not configured) |
| `rejected` | Return 400 — no entitlement granted |

---

## 4. IDEMPOTENCY & SECURITY

| Control | Implementation |
|---------|---------------|
| Cross-user replay prevention | Idempotency key = `userId:productId:token[:80]` |
| Duplicate grant prevention | `purchase_audit_log.idempotency_key` UNIQUE constraint |
| Client cannot self-grant VIP | `vip_subscriptions` has only SELECT policy for authenticated users |
| Client cannot set coin balance | `user_coins` has no INSERT/UPDATE policy; only `add_user_coins` RPC |
| Coin balance immutable audit | `coin_transactions` ledger — INSERT-only from server |
| All entitlements are server-derived | `verify-purchase` uses service_role for all writes |
| User identity from JWT | `supabaseUser.auth.getUser()` — never `body.userId` |

---

## 5. APPLE SETUP (developer action required)

### 5a. App Store Connect — Products

```
App Store Connect → Apps → PredictXta → In-App Purchases → +

Subscriptions (Auto-Renewable):
  Product ID: predictxta_vip_monthly
    Reference Name: VIP Monthly
    Subscription Group: PredictXta VIP
    Duration: 1 Month
    Price: USD 1.99
    Localization: "Monthly VIP"

  Product ID: predictxta_vip_6month
    Reference Name: VIP 6 Month
    Subscription Group: PredictXta VIP
    Duration: 6 Months
    Price: USD 8.39
    Localization: "6 Month VIP"

  Product ID: predictxta_vip_yearly
    Reference Name: VIP Yearly
    Subscription Group: PredictXta VIP
    Duration: 1 Year
    Price: USD 14.99
    Localization: "Annual VIP"

Consumables:
  Product ID: predictxta_coins_500   → USD 0.99
  Product ID: predictxta_coins_2500  → USD 3.99
  Product ID: predictxta_coins_5000  → USD 6.99
```

### 5b. App Store Connect API Key

```
App Store Connect → Users and Access → Integrations → App Store Connect API
  → + (Create key)
  Name:      PredictXta verify-purchase
  Access:    Finance
  → Download .p8 key

Add to Supabase secrets:
  APPLE_ISSUER_ID    = [Issuer ID from the page header]
  APPLE_KEY_ID       = [Key ID shown next to your key]
  APPLE_PRIVATE_KEY  = [contents of the downloaded .p8 file]
```

### 5c. Shared Secret (legacy fallback)

```
App Store Connect → Apps → PredictXta → In-App Purchases → App-Specific Shared Secret
  → Generate
  APPLE_SHARED_SECRET = [generated secret]
```

### 5d. Sandbox testing

```
App Store Connect → Users and Access → Sandbox Testers
  → + (Add tester with a real email you control)
  Use this Apple ID on device: Settings → App Store → Sandbox Account
```

---

## 6. GOOGLE PLAY SETUP (developer action required)

### 6a. Google Play Console — Products

```
Play Console → PredictXta (com.predictxta.sports) → Monetize

Subscriptions:
  predictxta_vip_monthly → Base plan: USD 1.99/month (auto-renewing)
  predictxta_vip_6month  → Base plan: USD 8.39/6 months
  predictxta_vip_yearly  → Base plan: USD 14.99/year

In-app products (consumable):
  predictxta_coins_500   → USD 0.99
  predictxta_coins_2500  → USD 3.99
  predictxta_coins_5000  → USD 6.99
```

### 6b. Service Account for Play Developer API

```
Google Cloud Console → IAM & Admin → Service Accounts
  → Create service account
  Name: predictxta-iap-verify
  → Keys → Add Key → JSON → download

Google Play Console → Setup → API access
  → Link to existing GCP project
  → Grant access to service account
  Permissions: View financial data, Manage orders and subscriptions

Add to Supabase secrets:
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = [full JSON file content]
  GOOGLE_PLAY_PACKAGE_NAME         = com.predictxta.sports
```

### 6c. License testing

```
Play Console → Setup → License testing
  → Add tester email(s)
  → License response: LICENSED
Use the tester account on a real device to test purchases
```

---

## 7. SUBSCRIPTION STATE HANDLING

| State | DB status | Entitlement |
|-------|-----------|-------------|
| Active, auto-renewing | `active` | ✅ Full access |
| Active, cancelled (expires in future) | `active` | ✅ Until expiry |
| Expired | Not updated (query checks `expires_at`) | ❌ No access |
| Grace period (billing retry) | `active` | ✅ (7-day grace) |
| Refunded / revoked | `rejected` in audit log | ❌ No access |

---

## 8. COINS SECURITY MODEL

```
Client request → verify-purchase → add_user_coins RPC (SECURITY DEFINER)
                                     ├── UPDATE user_coins.balance (never below 0)
                                     └── INSERT coin_transactions (immutable ledger)
```

- Client **cannot** write to `user_coins` (no INSERT/UPDATE policy)
- Client **cannot** write to `coin_transactions` (no INSERT policy)
- `add_user_coins` is `SECURITY DEFINER` with fixed `search_path`
- All coin debits (spending) must also go through a server-side RPC

---

## 9. WEB PLATFORM

In-App Purchases are not available on web (`platform === 'web'`).
`react-native-iap` and `react-native-nitro-modules` resolve to no-op shims on web.
`iapAvailable` returns `false` and the VIP screen shows:

> "In-App Purchases require a release build from the App Store or Google Play.
>  This preview build does not support native payments."

---

## 10. RESTORE PURCHASES

iOS: `getAvailablePurchases()` → returns all non-consumed transactions →
     each subscription token sent to `verify-purchase` with `isRestore: true` →
     server verifies and re-grants if valid → `refreshVipStatus()` updates UI.

Android: Google Play handles restore automatically for subscriptions.
         User signs in with the same Google account → subscription reactivates.

---

## 11. PHASE 4 RELEASE GATE

### Code-complete: ✅

| Check | Status |
|-------|--------|
| Product IDs aligned (client = server = stores) | ✅ |
| IAP shim correctly scoped to web/SSR only | ✅ |
| `verify-purchase` Apple App Store Server API | ✅ |
| `verify-purchase` Google Play Developer API | ✅ |
| Idempotency (user-scoped keys) | ✅ |
| No client can self-grant VIP | ✅ |
| Coins via ledger-backed RPC only | ✅ |
| `coin_transactions` ledger table + RLS | ✅ |
| `purchase_audit_log.updated_at` column | ✅ |
| Restore purchases (server-verified) | ✅ |
| Web unavailable messaging | ✅ |
| Duplicate grant protection | ✅ |

### Manual steps remaining (developer action)

| Step | Priority |
|------|----------|
| Create all 6 products in App Store Connect | P0 — blocks iOS purchases |
| Create all 6 products in Google Play Console | P0 — blocks Android purchases |
| Set `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` in Supabase secrets | P0 — enables real iOS verification |
| Set `APPLE_SHARED_SECRET` in Supabase secrets | P1 — legacy fallback |
| Set `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in Supabase secrets | P0 — enables real Android verification |
| Set `GOOGLE_PLAY_PACKAGE_NAME=com.predictxta.sports` in Supabase secrets | P0 |
| Configure sandbox testers in App Store Connect | P1 — required for review |
| Configure license testers in Google Play | P1 — required for internal testing |
| Provide reviewer instructions in App Store Connect review notes | P1 |
| Test sandbox purchase → cancellation → restore → refund cycle | P0 before submission |
