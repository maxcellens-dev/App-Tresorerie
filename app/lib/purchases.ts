/**
 * Couche d'abstraction des paiements Premium — POINT D'INTÉGRATION UNIQUE.
 *
 * À brancher selon la plateforme :
 *  - Web (déploiement Vercel)  : Stripe Checkout (clé publishable + endpoint serveur / Edge Function
 *    qui crée la session, puis webhook Stripe → met profiles.is_premium = true).
 *  - iOS / Android (Expo natif) : RevenueCat (react-native-purchases) + produits App Store / Play ;
 *    le webhook RevenueCat met profiles.is_premium à jour.
 *
 * Tant que ce n'est pas configuré, on renvoie `not_configured` (l'UI affiche « bientôt »).
 * L'entitlement réel reste profiles.is_premium (lu par usePlan), alimenté par le webhook.
 */
import { Platform } from 'react-native';

export type PurchaseReason = 'not_configured' | 'cancelled' | 'error';
export interface PurchaseResult { ok: boolean; reason?: PurchaseReason; message?: string }

/** true si un fournisseur de paiement est configuré pour la plateforme courante. */
export function isPurchaseConfigured(): boolean {
  // À passer à true une fois Stripe (web) / RevenueCat (natif) branchés.
  return false;
}

export async function purchasePremium(_userId: string | undefined): Promise<PurchaseResult> {
  if (!isPurchaseConfigured()) {
    return { ok: false, reason: 'not_configured', message: 'Le paiement sera bientôt disponible.' };
  }
  // eslint-disable-next-line no-constant-condition
  if (Platform.OS === 'web') {
    // TODO Stripe Checkout : créer la session côté serveur puis rediriger.
    return { ok: false, reason: 'not_configured' };
  }
  // TODO RevenueCat : Purchases.purchasePackage(...)
  return { ok: false, reason: 'not_configured' };
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isPurchaseConfigured()) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'not_configured' };
}
