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

export const RC_ENTITLEMENT_ID = 'Relyka_Premium';
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

// Product IDs Play Store / App Store pour l'abonnement Premium.
const PRODUCT_IDS = {
  monthly: '1001:201',
  annual:  '1001:202',
} as const;

/** Achète directement le plan Premium choisi (mensuel ou annuel) via RevenueCat. */
export async function purchasePremium(plan: 'monthly' | 'annual', _userId?: string): Promise<PurchaseResult> {
  if (!PURCHASES_SUPPORTED) return { ok: false, reason: 'not_supported' };
  if (!configured) return { ok: false, reason: 'not_configured', message: 'Paiement non initialisé.' };
  try {
    // On passe par les Offerings pour obtenir le Package RC (la voie recommandée).
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    const productId = PRODUCT_IDS[plan];
    const pkg = current?.availablePackages.find(
      (p) => p.product.identifier === productId
    );
    if (pkg) {
      await Purchases.purchasePackage(pkg);
    } else {
      // Fallback : achat direct par productId (si l'offering n'est pas configurée).
      const products = await Purchases.getProducts([productId]);
      if (!products.length) return { ok: false, reason: 'not_configured', message: "Produit introuvable dans le store." };
      await Purchases.purchaseStoreProduct(products[0]);
    }
    return { ok: true };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'error', message: e?.message ?? "L'achat n'a pas pu aboutir." };
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

/** Achat d'un pack de gemmes (produit consommable). ok=true → créditer les gemmes côté app.
 *  On essaie d'abord les Offerings (voie recommandée), puis l'achat direct par productId.
 *  En cas d'introuvable, on renvoie la liste des IDs réellement disponibles (aide au diagnostic). */
export async function purchaseGemsPack(productId: string): Promise<PurchaseResult> {
  if (!PURCHASES_SUPPORTED || !configured) return { ok: false, reason: 'not_supported' };
  try {
    // 1) Offerings : cherche un package dont le produit correspond (toutes offerings, pas que current).
    const offerings = await Purchases.getOfferings();
    const allOfferings = [offerings.current, ...Object.values((offerings.all as any) ?? {})].filter(Boolean) as any[];
    for (const off of allOfferings) {
      const pkg = off.availablePackages?.find((p: any) => p.product.identifier === productId);
      if (pkg) { await Purchases.purchasePackage(pkg); return { ok: true }; }
    }
    // 2) Achat direct par productId (consommable hors offering).
    const products = await Purchases.getProducts([productId]);
    if (products.length) { await Purchases.purchaseStoreProduct(products[0]); return { ok: true }; }
    // 3) Introuvable → liste des identifiants disponibles pour repérer le mismatch.
    const available = new Set<string>();
    for (const off of allOfferings) for (const p of off.availablePackages ?? []) available.add(p.product.identifier);
    const list = [...available].join(', ') || '(aucun produit configuré dans l’offering)';
    return { ok: false, reason: 'not_configured', message: `Produit « ${productId} » introuvable. IDs disponibles dans RevenueCat : ${list}` };
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
