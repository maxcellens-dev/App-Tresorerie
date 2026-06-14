/**
 * Couche d'abstraction des paiements Premium — version NATIVE (iOS / Android) via RevenueCat.
 * Chargée automatiquement par Metro à la place de `purchases.ts` sur mobile.
 *
 * Pré-requis côté tableau de bord RevenueCat :
 *  - un entitlement « Relyka Pro » (cf. RC_ENTITLEMENT_ID),
 *  - une offering avec un produit MENSUEL et un produit ANNUEL,
 *  - un Paywall configuré (utilisé par presentPaywall).
 *  - les produits créés dans App Store Connect / Google Play Console.
 *
 * ⚠️ Remplacer les clés de test par les clés de production RevenueCat (appl_… / goog_…).
 */
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo } from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

export type PurchaseReason = 'not_configured' | 'not_supported' | 'cancelled' | 'error';
export interface PurchaseResult { ok: boolean; reason?: PurchaseReason; message?: string }

export interface SubscriptionInfo {
  active: boolean;
  willRenew: boolean;
  periodType: string | null;
  expirationDate: string | null;
  productId: string | null;
  managementURL: string | null;
}

export const RC_ENTITLEMENT_ID = 'Relyka Pro';
export const PURCHASES_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

// Clés publiques RevenueCat par plateforme.
// Android = clé de prod (goog_…). iOS = encore en test tant qu'App Store Connect n'est pas configuré (TODO : appl_…).
const API_KEY =
  Platform.select({
    ios: 'test_SUKUHHzOlMzZcirNqYJCEbRgEsT',
    android: 'goog_XMLzcfBAvumphLKmuzyNkhXeGWg',
    default: '',
  }) || '';

let configured = false;

export function isPurchaseConfigured(): boolean { return PURCHASES_SUPPORTED && !!API_KEY; }

function entitlementActive(ci: CustomerInfo): boolean {
  return typeof ci.entitlements.active[RC_ENTITLEMENT_ID] !== 'undefined';
}

export async function configurePurchases(userId?: string): Promise<void> {
  if (!PURCHASES_SUPPORTED || configured || !API_KEY) return;
  try {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: API_KEY, appUserID: userId ?? undefined });
    configured = true;
  } catch { /* configuration impossible (ex. Expo Go) — ignore */ }
}

export async function logInPurchases(userId: string): Promise<void> {
  if (!PURCHASES_SUPPORTED || !configured) return;
  try { await Purchases.logIn(userId); } catch { /* ignore */ }
}

export async function logOutPurchases(): Promise<void> {
  if (!PURCHASES_SUPPORTED || !configured) return;
  try { await Purchases.logOut(); } catch { /* ignore */ }
}

export async function isProActive(): Promise<boolean> {
  if (!PURCHASES_SUPPORTED || !configured) return false;
  try { return entitlementActive(await Purchases.getCustomerInfo()); } catch { return false; }
}

/** Présente le Paywall RevenueCat (offres mensuelle/annuelle). ok=true si achat ou restauration. */
export async function purchasePremium(_userId?: string): Promise<PurchaseResult> {
  if (!PURCHASES_SUPPORTED) return { ok: false, reason: 'not_supported' };
  if (!configured) return { ok: false, reason: 'not_configured', message: 'Paiement non initialisé.' };
  try {
    const r = await RevenueCatUI.presentPaywall();
    switch (r) {
      case PAYWALL_RESULT.PURCHASED:
      case PAYWALL_RESULT.RESTORED:
        return { ok: true };
      case PAYWALL_RESULT.CANCELLED:
        return { ok: false, reason: 'cancelled' };
      case PAYWALL_RESULT.NOT_PRESENTED:
        return { ok: false, reason: 'not_configured', message: "Aucune offre n'est configurée dans RevenueCat." };
      default:
        return { ok: false, reason: 'error', message: "L'achat n'a pas pu aboutir." };
    }
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message ?? "Erreur lors de l'achat." };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!PURCHASES_SUPPORTED || !configured) return { ok: false, reason: 'not_supported' };
  try {
    const ci = await Purchases.restorePurchases();
    return entitlementActive(ci)
      ? { ok: true }
      : { ok: false, reason: 'error', message: 'Aucun abonnement actif à restaurer.' };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message ?? 'Échec de la restauration.' };
  }
}

export async function getSubscriptionInfo(): Promise<SubscriptionInfo | null> {
  if (!PURCHASES_SUPPORTED || !configured) return null;
  try {
    const ci = await Purchases.getCustomerInfo();
    const ent = ci.entitlements.active[RC_ENTITLEMENT_ID];
    return {
      active: !!ent,
      willRenew: ent?.willRenew ?? false,
      periodType: ent?.periodType ?? null,
      expirationDate: ent?.expirationDate ?? null,
      productId: ent?.productIdentifier ?? null,
      managementURL: ci.managementURL ?? null,
    };
  } catch { return null; }
}

/** Achat d'un pack de gemmes (produit consommable). ok=true → créditer les gemmes côté app. */
export async function purchaseGemsPack(productId: string): Promise<PurchaseResult> {
  if (!PURCHASES_SUPPORTED || !configured) return { ok: false, reason: 'not_supported' };
  try {
    const products = await Purchases.getProducts([productId]);
    if (!products.length) return { ok: false, reason: 'not_configured', message: 'Produit indisponible (à créer dans le store).' };
    await Purchases.purchaseStoreProduct(products[0]);
    return { ok: true };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'error', message: e?.message ?? "Échec de l'achat." };
  }
}

export function addProListener(cb: (active: boolean) => void): () => void {
  if (!PURCHASES_SUPPORTED || !configured) return () => {};
  const handler = (ci: CustomerInfo) => cb(entitlementActive(ci));
  Purchases.addCustomerInfoUpdateListener(handler);
  return () => { try { Purchases.removeCustomerInfoUpdateListener(handler); } catch { /* ignore */ } };
}
