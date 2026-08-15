/**
 * react-native-iap web shim
 *
 * react-native-iap is a native-only module (iOS StoreKit / Android Billing).
 * It cannot run on web. This shim provides no-op stubs so Metro can bundle
 * the app for web preview without crashing on unresolvable native internals
 * (e.g. Platform, processColor) that react-native-iap pulls in.
 *
 * All exports match the API surface used by iapService.ts / useIAP.ts.
 */

'use strict';

const noop = () => {};
const noopAsync = async () => {};
const noopSubscription = { remove: noop };

module.exports = {
  // Connection
  initConnection: noopAsync,
  endConnection: noopAsync,

  // Products / subscriptions
  getProducts: async () => [],
  getSubscriptions: async () => [],

  // Purchase requests
  requestPurchase: noopAsync,
  requestSubscription: noopAsync,

  // Transaction management
  finishTransaction: noopAsync,
  acknowledgePurchaseAndroid: noopAsync,
  consumePurchaseAndroid: noopAsync,

  // Listeners — return a removable subscription object
  purchaseUpdatedListener: () => noopSubscription,
  purchaseErrorListener: () => noopSubscription,

  // Enums used in iapService.ts
  PurchaseStateAndroid: { PURCHASED: 1 },
  IAPErrorCode: {},
};
