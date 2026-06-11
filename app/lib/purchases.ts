/**
 * Couche d'abstraction des paiements Premium — version WEB / fallback.
 *
 * Metro charge automatiquement `purchases.native.ts` sur iOS/Android (RevenueCat),
 * et CE fichier sur le web (où les achats in-app natifs n'existent pas).
 * L'entitlement réel reste `profiles.is_premium` (lu par usePlan), mis à jour :
 *  - sur natif : par la synchronisation RevenueCat (PurchasesSync) + après un achat,
 *  - sur web : par un futur Stripe Checkout (non branché ici).
 */

export type PurchaseReason = 'not_configured' | 'not_supported' | 'cancelled' | 'error';
export interface PurchaseResult { ok: boolean; reason?: PurchaseReason; message?: string }

export interface SubscriptionInfo {
  active: boolean;
  /** true tant que l'abonnement se renouvellera ; false si annulé (actif jusqu'à l'échéance). */
  willRenew: boolean;
  periodType: string | null;   // 'normal' | 'trial' | 'intro'
  expirationDate: string | null;
  productId: string | null;
  /** URL de gestion (App Store / Play Store) pour annuler/changer d'offre. */
  managementURL: string | null;
}

/** Identifiant d'entitlement configuré dans le tableau de bord RevenueCat. */
export const RC_ENTITLEMENT_ID = 'Relyka Pro';

/** Les achats in-app natifs ne sont pas disponibles sur cette plateforme (web). */
export const PURCHASES_SUPPORTED = false;

export function isPurchaseConfigured(): boolean { return false; }

export async function configurePurchases(_userId?: string): Promise<void> { /* no-op web */ }
export async function logInPurchases(_userId: string): Promise<void> { /* no-op web */ }
export async function logOutPurchases(): Promise<void> { /* no-op web */ }

export async function isProActive(): Promise<boolean> { return false; }

export async function purchasePremium(_userId?: string): Promise<PurchaseResult> {
  return {
    ok: false,
    reason: 'not_supported',
    message: "L'abonnement Premium se souscrit depuis l'application mobile Relyka (iOS / Android).",
  };
}

export async function restorePurchases(): Promise<PurchaseResult> {
  return {
    ok: false,
    reason: 'not_supported',
    message: "La restauration des achats est disponible depuis l'application mobile.",
  };
}

export async function getSubscriptionInfo(): Promise<SubscriptionInfo | null> { return null; }

/** Achat d'un pack de gemmes en argent réel (consommable store). No-op / message sur web. */
export async function purchaseGemsPack(_productId: string): Promise<PurchaseResult> {
  return { ok: false, reason: 'not_supported', message: "L'achat de relyks est disponible depuis l'application mobile." };
}

/** S'abonne aux changements d'entitlement (achat, renouvellement, expiration). No-op sur web. */
export function addProListener(_cb: (active: boolean) => void): () => void { return () => {}; }
