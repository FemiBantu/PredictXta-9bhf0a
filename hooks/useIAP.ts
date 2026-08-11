/**
 * useIAP.ts
 * React hook managing IAP connection, product loading, and purchase flow.
 * Gracefully degrades when react-native-iap native module is not linked
 * (preview builds, Expo Go, OnSpace APK environment).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  connectIAP, disconnectIAP, loadStoreProducts, getDisplayPrice,
  purchaseSubscription, purchaseProduct, completePurchase,
  setupPurchaseListeners, grantVipEntitlement, grantCoins,
  checkActiveSubscription, IAP_PLANS, COIN_PACKS,
  isIAPAvailable,
  type IAPPlan, type StoreProduct, type Purchase, type PurchaseError,
} from '@/services/iapService';
import { useAuth } from '@/template';

export interface IAPState {
  connected: boolean;
  storeProducts: StoreProduct[];
  vipPlans: IAPPlan[];
  coinPacks: IAPPlan[];
  loadingProducts: boolean;
  purchasing: boolean;
  lastPurchasedId: string | null;
  purchaseError: string | null;
  isVip: boolean;
  activePlan: string | null;
  vipExpiresAt: string | null;
  checkingVip: boolean;
  /** false when react-native-iap native module is not linked */
  iapAvailable: boolean;
  buyPlan: (plan: IAPPlan) => Promise<{ success: boolean; error?: string }>;
  restorePurchases: () => Promise<void>;
  refreshVipStatus: () => Promise<void>;
  clearError: () => void;
}

export function useIAP(): IAPState {
  const { user } = useAuth();

  const [connected, setConnected] = useState(false);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [lastPurchasedId, setLastPurchasedId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [isVip, setIsVip] = useState(false);
  const [activePlan, setActivePlan] = useState<string | null>(null);
  const [vipExpiresAt, setVipExpiresAt] = useState<string | null>(null);
  const [checkingVip, setCheckingVip] = useState(false);

  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const [iapAvailable, setIapAvailable] = useState(false);

  // Lazily check IAP availability inside useEffect — never at render/init time
  // because isIAPAvailable() calls require('react-native-iap') which can crash
  // the Hermes module graph if invoked during module initialization.
  useEffect(() => {
    setIapAvailable(isIAPAvailable());
  }, []);

  // ─── Connect to IAP store on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!iapAvailable) return; // skip if native module not linked

    let mounted = true;
    async function setup() {
      const ok = await connectIAP();
      if (!mounted) return;
      setConnected(ok);
      if (ok) {
        setLoadingProducts(true);
        const products = await loadStoreProducts();
        if (mounted) {
          setStoreProducts(products);
          setLoadingProducts(false);
        }
      }
    }

    setup();
    return () => {
      mounted = false;
      disconnectIAP();
    };
  }, [iapAvailable]);

  // ─── Purchase listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected || !iapAvailable) return;

    const cleanup = setupPurchaseListeners(
      async (purchase: Purchase) => {
        console.log('[useIAP] Purchase received:', purchase.productId);
        setPurchasing(false);
        setLastPurchasedId(purchase.productId);

        if (user?.id) {
          const plan =
            IAP_PLANS.find((p) => p.id === purchase.productId) ??
            COIN_PACKS.find((p) => p.id === purchase.productId);

          if (plan) {
            if (plan.isConsumable && plan.coinAmount) {
              await grantCoins(user.id, plan.coinAmount);
            } else {
              await grantVipEntitlement(user.id, plan, purchase);
              const status = await checkActiveSubscription(user.id);
              setIsVip(status.isVip);
              setActivePlan(status.plan);
              setVipExpiresAt(status.expiresAt);
            }
          }
        }

        await completePurchase(purchase);
      },
      (error: PurchaseError) => {
        setPurchasing(false);
        if (error.code !== 'E_USER_CANCELLED') {
          setPurchaseError(error.message ?? 'Purchase failed');
        }
      },
    );

    cleanupListenersRef.current = cleanup;
    return () => cleanup();
  }, [connected, user?.id, iapAvailable]);

  // ─── VIP status ─────────────────────────────────────────────────────────────
  const refreshVipStatus = useCallback(async () => {
    if (!user?.id) return;
    setCheckingVip(true);
    const status = await checkActiveSubscription(user.id);
    setIsVip(status.isVip);
    setActivePlan(status.plan);
    setVipExpiresAt(status.expiresAt);
    setCheckingVip(false);
  }, [user?.id]);

  useEffect(() => {
    refreshVipStatus();
  }, [refreshVipStatus]);

  // ─── Inject real store prices ────────────────────────────────────────────────
  const vipPlans = IAP_PLANS.map((plan) => ({
    ...plan,
    fallbackPrice: getDisplayPrice(storeProducts, plan.id, plan.fallbackPrice),
  }));

  const coinPacks = COIN_PACKS.map((pack) => ({
    ...pack,
    fallbackPrice: getDisplayPrice(storeProducts, pack.id, pack.fallbackPrice),
  }));

  // ─── Buy ─────────────────────────────────────────────────────────────────────
  const buyPlan = useCallback(
    async (plan: IAPPlan): Promise<{ success: boolean; error?: string }> => {
      if (!iapAvailable) {
        return { success: false, error: 'In-App Purchases are not available on this build. Please use the release version from the App Store or Google Play.' };
      }
      if (!connected) {
        return { success: false, error: 'Store not available. Please check your connection and try again.' };
      }

      setPurchasing(true);
      setPurchaseError(null);

      try {
        const result = plan.isSubscription
          ? await purchaseSubscription(plan.id)
          : await purchaseProduct(plan.id);

        if (!result.success) {
          setPurchasing(false);
          if (result.error !== 'cancelled') {
            setPurchaseError(result.error ?? 'Purchase failed');
          }
          return result;
        }

        // Listener handles completion — don't reset purchasing here
        return { success: true };
      } catch (err) {
        setPurchasing(false);
        const msg = err instanceof Error ? err.message : 'Purchase failed';
        setPurchaseError(msg);
        return { success: false, error: msg };
      }
    },
    [connected, iapAvailable],
  );

  // ─── Restore purchases ───────────────────────────────────────────────────────
  const restorePurchases = useCallback(async () => {
    // Re-check DB subscription — covers receipt-validated purchases
    await refreshVipStatus();
  }, [refreshVipStatus]);

  const clearError = useCallback(() => setPurchaseError(null), []);

  return {
    connected,
    storeProducts,
    vipPlans,
    coinPacks,
    loadingProducts,
    purchasing,
    lastPurchasedId,
    purchaseError,
    isVip,
    activePlan,
    vipExpiresAt,
    checkingVip,
    iapAvailable,
    buyPlan,
    restorePurchases,
    refreshVipStatus,
    clearError,
  };
}
