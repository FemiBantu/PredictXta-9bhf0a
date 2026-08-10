
/**
 * iapService.ts
 * Native In-App Purchase service — Apple App Store (StoreKit 2) + Google Play Billing
 *
 * ⚠️  react-native-iap v12+ requires react-native-nitro-modules (native rebuild).
 *     All imports are wrapped in try/catch so the app still runs in environments
 *     where the native module is not linked (preview APKs, Expo Go, etc.).
 *
 * ⚠️  BEFORE GOING LIVE you MUST:
 *   1. Create products in App Store Connect → Monetization → In-App Purchases
 *   2. Create products in Google Play Console → Monetization → In-app products / Subscriptions
 *   3. Replace the placeholder PRODUCT_IDS below with your real IDs
 *   4. Build a proper release APK / IPA (not the OnSpace preview build)
 */

import { Platform } from 'react-native';
import { getSupabaseClient } from '@/template';

// ─── Safe react-native-iap import ────────────────────────────────────────────
// react-native-iap requires a full native build with react-native-nitro-modules.
// On Android (Hermes), requiring it at module init time can crash the entire
// module graph even inside try/catch — because some native exception propagation
// bypasses JS try/catch under Hermes. We therefore keep iap null at init time
// and load it lazily on first async API call instead.
//
// NEVER call require('react-native-iap') at module level.
let iap: typeof import('react-native-iap') | null = null;
let iapLoadAttempted = false;

function getIap(): typeof import('react-native-iap') | null {
  if (iapLoadAttempted) return iap;
  iapLoadAttempted = true;
  try {
    iap = require('react-native-iap');
  } catch {
    console.warn('[IAP] react-native-iap not available — native module not linked. IAP features will be disabled.');
    iap = null;
  }
  return iap;
}

// Re-export only what we use, with safe stubs
// PurchaseStateAndroid is fetched lazily — never at module init time
function getPurchaseStateAndroid(): { PURCHASED: number } {
  return getIap()?.PurchaseStateAndroid ?? { PURCHASED: 1 };
}

// ─── Product IDs ──────────────────────────────────────────────────────────────
export const PRODUCT_IDS = {
  VIP_MONTHLY:   'predictx_vip_monthly',
  VIP_BIANNUAL:  'predictx_vip_biannual',
  VIP_ANNUAL:    'predictx_vip_annual',
  COINS_500:     'predictx_coins_100',
  COINS_2500:    'predictx_coins_500',
  COINS_5000:    'predictx_coins_1000',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

export const SUBSCRIPTION_IDS: string[] = [
  PRODUCT_IDS.VIP_MONTHLY,
  PRODUCT_IDS.VIP_BIANNUAL,
  PRODUCT_IDS.VIP_ANNUAL,
];

export const ONE_TIME_IDS: string[] = [
  PRODUCT_IDS.COINS_500,
  PRODUCT_IDS.COINS_2500,
  PRODUCT_IDS.COINS_5000,
];

// ─── Plan metadata ────────────────────────────────────────────────────────────
export interface IAPPlan {
  id: ProductId;
  name: string;
  description: string;
  fallbackPrice: string;
  daysValid: number;
  isSubscription: boolean;
  isConsumable: boolean;
  savingLabel?: string;
  mostPopular?: boolean;
  accentColor: string;
  coinAmount?: number;
}

export const IAP_PLANS: IAPPlan[] = [
  {
    id: PRODUCT_IDS.VIP_MONTHLY,
    name: 'Monthly',
    description: 'Full VIP access billed monthly',
    fallbackPrice: '$1.99/mo',
    daysValid: 30,
    isSubscription: true,
    isConsumable: false,
    accentColor: '#4ECDC4',
  },
  {
    id: PRODUCT_IDS.VIP_BIANNUAL,
    name: '6 Months',
    description: 'Full VIP access — billed every 6 months',
    fallbackPrice: '$8.39/6mo',
    daysValid: 180,
    isSubscription: true,
    isConsumable: false,
    savingLabel: 'Save 30%',
    mostPopular: true,
    accentColor: '#FFD700',
  },
  {
    id: PRODUCT_IDS.VIP_ANNUAL,
    name: 'Annual',
    description: 'Full VIP access billed yearly — best value',
    fallbackPrice: '$14.99/yr',
    daysValid: 365,
    isSubscription: true,
    isConsumable: false,
    savingLabel: 'Save 37%',
    accentColor: '#00FF87',
  },
];

export const COIN_PACKS: IAPPlan[] = [
  {
    id: PRODUCT_IDS.COINS_500,
    name: '500 Coins',
    description: 'Starter pack',
    fallbackPrice: '$0.99',
    daysValid: 0,
    isSubscription: false,
    isConsumable: true,
    accentColor: '#FFD700',
    coinAmount: 500,
  },
  {
    id: PRODUCT_IDS.COINS_2500,
    name: '2500 Coins',
    description: 'Value pack',
    fallbackPrice: '$3.99',
    daysValid: 0,
    isSubscription: false,
    isConsumable: true,
    savingLabel: 'Save 20%',
    mostPopular: true,
    accentColor: '#FFD700',
    coinAmount: 2500,
  },
  {
    id: PRODUCT_IDS.COINS_5000,
    name: '5000 Coins',
    description: 'Power pack',
    fallbackPrice: '$6.99',
    daysValid: 0,
    isSubscription: false,
    isConsumable: true,
    savingLabel: 'Save 30%',
    accentColor: '#FFD700',
    coinAmount: 5000,
  },
];

// ─── Type stubs (so TypeScript is happy when iap is null) ─────────────────────
export type StoreProduct = {
  productId: string;
  localizedPrice?: string;
  [key: string]: unknown;
};

export type Purchase = {
  productId: string;
  transactionId?: string;
  purchaseStateAndroid?: number;
  [key: string]: unknown;
};

export type PurchaseError = {
  code?: string;
  message?: string;
};

// ─── Connection ───────────────────────────────────────────────────────────────
export async function connectIAP(): Promise<boolean> {
  const iap = getIap();
  if (!iap) return false;
  try {
    await iap.initConnection();
    console.log('[IAP] Connection established');
    return true;
  } catch (err) {
    console.warn('[IAP] Connection failed:', err);
    return false;
  }
}

export async function disconnectIAP(): Promise<void> {
  const iap = getIap();
  if (!iap) return;
  try { await iap.endConnection(); } catch { /* ignore */ }
}

// ─── Product loading ──────────────────────────────────────────────────────────
export async function loadStoreProducts(): Promise<StoreProduct[]> {
  const iap = getIap();
  if (!iap) return [];
  try {
    const [subscriptions, products] = await Promise.all([
      iap.getSubscriptions({ skus: SUBSCRIPTION_IDS }),
      iap.getProducts({ skus: ONE_TIME_IDS }),
    ]);
    const all = [...subscriptions, ...products] as StoreProduct[];
    console.log(`[IAP] Loaded ${all.length} products`);
    return all;
  } catch (err) {
    console.warn('[IAP] Failed to load products:', err);
    return [];
  }
}

export function getDisplayPrice(
  products: StoreProduct[],
  productId: string,
  fallback: string,
): string {
  const product = products.find((p) => p.productId === productId);
  if (!product) return fallback;
  return (product.localizedPrice as string) ?? fallback;
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
export interface PurchaseResult {
  success: boolean;
  purchase?: Purchase;
  error?: string;
}

export async function purchaseSubscription(productId: string): Promise<PurchaseResult> {
  const iap = getIap();
  if (!iap) return { success: false, error: 'IAP not available on this build.' };
  try {
    if (Platform.OS === 'android') {
      await iap.requestSubscription({
        sku: productId,
        subscriptionOffers: [{ sku: productId, offerToken: '' }],
      } as any);
    } else {
      await iap.requestSubscription({ sku: productId } as any);
    }
    return { success: true };
  } catch (err) {
    const iapError = err as PurchaseError;
    if (iapError?.code === 'E_USER_CANCELLED') return { success: false, error: 'cancelled' };
    const message = iapError?.message ?? 'Purchase failed';
    console.warn('[IAP] purchaseSubscription error:', message);
    return { success: false, error: message };
  }
}

export async function purchaseProduct(productId: string): Promise<PurchaseResult> {
  const iap = getIap();
  if (!iap) return { success: false, error: 'IAP not available on this build.' };
  try {
    await iap.requestPurchase({ sku: productId } as any);
    return { success: true };
  } catch (err) {
    const iapError = err as PurchaseError;
    if (iapError?.code === 'E_USER_CANCELLED') return { success: false, error: 'cancelled' };
    const message = iapError?.message ?? 'Purchase failed';
    console.warn('[IAP] purchaseProduct error:', message);
    return { success: false, error: message };
  }
}

// ─── Transaction completion ───────────────────────────────────────────────────
export async function completePurchase(purchase: Purchase): Promise<void> {
  const iap = getIap();
  if (!iap) return;
  try {
    const plan = [...IAP_PLANS, ...COIN_PACKS].find((p) => p.id === purchase.productId);
    await iap.finishTransaction({ purchase: purchase as any, isConsumable: plan?.isConsumable ?? false });
    console.log('[IAP] Transaction finished:', purchase.productId);
  } catch (err) {
    console.warn('[IAP] finishTransaction error:', err);
  }
}

// ─── Listeners ────────────────────────────────────────────────────────────────
export type PurchaseUpdateHandler = (purchase: Purchase) => Promise<void>;
export type PurchaseErrorHandler = (error: PurchaseError) => void;

export function setupPurchaseListeners(
  onUpdate: PurchaseUpdateHandler,
  onError: PurchaseErrorHandler,
): () => void {
  const iap = getIap();
  if (!iap) return () => {};

  const updateSub = iap.purchaseUpdatedListener(async (purchase: any) => {
    console.log('[IAP] Purchase updated:', purchase.productId, purchase.transactionId);
    if (Platform.OS === 'android') {
      const state = purchase.purchaseStateAndroid;
      if (state === (getPurchaseStateAndroid() as any).PURCHASED || state === undefined) {
        await onUpdate(purchase as Purchase);
      }
    } else {
      await onUpdate(purchase as Purchase);
    }
  });

  const errorSub = iap.purchaseErrorListener((error: any) => {
    if (error?.code !== 'E_USER_CANCELLED') {
      console.warn('[IAP] Purchase error:', error?.message, error?.code);
      onError(error as PurchaseError);
    }
  });

  return () => {
    updateSub.remove();
    errorSub.remove();
  };
}

// ─── Backend entitlement sync ─────────────────────────────────────────────────
export async function grantVipEntitlement(
  userId: string,
  plan: IAPPlan,
  purchase: Purchase,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const expiresAt =
      plan.daysValid > 0
        ? new Date(Date.now() + plan.daysValid * 24 * 60 * 60 * 1000).toISOString()
        : new Date('2099-12-31').toISOString();

    await supabase
      .from('vip_subscriptions')
      .update({ status: 'superseded' })
      .eq('user_id', userId)
      .eq('status', 'active');

    const { error } = await supabase.from('vip_subscriptions').insert({
      user_id: userId,
      plan: plan.id,
      status: 'active',
      expires_at: expiresAt,
    });

    if (error) return { ok: false, error: error.message };
    console.log('[IAP] VIP entitlement granted:', plan.id, 'expires:', expiresAt);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function grantCoins(
  userId: string,
  coinAmount: number,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('add_user_coins', {
      p_user_id: userId,
      p_amount: coinAmount,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Active subscription check ────────────────────────────────────────────────
export async function checkActiveSubscription(
  userId: string,
): Promise<{ isVip: boolean; plan: string | null; expiresAt: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('vip_subscriptions')
      .select('plan, expires_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return { isVip: false, plan: null, expiresAt: null };
    const expires = new Date(data[0].expires_at);
    const isVip = expires > new Date();
    return { isVip, plan: data[0].plan, expiresAt: data[0].expires_at };
  } catch {
    return { isVip: false, plan: null, expiresAt: null };
  }
}

/** Whether the native IAP module is available on this build */
export function isIAPAvailable(): boolean {
  return getIap() !== null;
}
