// Supabase Edge Function — Webhook RevenueCat. Deux responsabilités, toutes deux VÉRIFIÉES SERVEUR :
//   1. créditer les requêtes IA achetées à l'unité (packs consommables) ;
//   2. poser / retirer le droit PREMIUM (`profiles.is_premium`) au fil de l'abonnement.
//
// Déploiement :
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<un_secret_que_tu_choisis>
//
// Config côté RevenueCat (Dashboard → Project → Integrations → Webhooks) :
//   • URL     : https://<ref>.supabase.co/functions/v1/revenuecat-webhook
//   • Header  : Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>   (le MÊME secret)
//
// ── POURQUOI LE PREMIUM PASSE PAR ICI (migration 203) ───────────────────────────────────────────
// Le droit Premium était posé par le TÉLÉPHONE : après un achat, l'app écrivait elle-même
// `is_premium = true` dans la base. Or l'app parle directement à la base avec le jeton de son
// utilisateur : n'importe qui pouvait envoyer la même écriture à la main et s'offrir l'abonnement.
// La colonne est désormais verrouillée pour les clients ; seule la clé de SERVICE (donc cette
// fonction) peut la changer. RevenueCat reste la source de vérité, mais c'est le serveur qui
// l'interroge — le client ne fait plus que constater.
//
// Avantage de collage : ce webhook ne dépend PAS de la version de l'app installée. Un achat fait
// depuis un ancien client active le Premium tout aussi bien.
//
// L'app fait `Purchases.logIn(<user Supabase>)` → `app_user_id` = l'id du profil concerné.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Entitlement RevenueCat qui porte l'abonnement Premium (doit rester aligné sur lib/platform/purchases). */
const PREMIUM_ENTITLEMENT = 'Relyka_Premium';
/** Identifiants des produits d'abonnement (repli quand l'événement ne porte pas d'entitlement). */
const PREMIUM_PRODUCTS = ['1001:201', '1001:202'];

/**
 * L'événement ACTIVE le Premium, le RETIRE, ou ne le concerne pas.
 *
 * ⚠️ `CANCELLATION` ne retire RIEN : dans le vocabulaire RevenueCat, c'est « ne se renouvellera
 * pas » — l'abonnement reste actif jusqu'à son échéance, et c'est `EXPIRATION` qui la marque.
 * Retirer le Premium à l'annonce de la résiliation reviendrait à couper le service déjà payé.
 */
function premiumEffect(type: string): 'grant' | 'revoke' | null {
  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TRANSFER':               // réinstallation / changement d'appareil
      return 'grant';
    case 'EXPIRATION':
    case 'REFUND':
    case 'SUBSCRIPTION_PAUSED':
      return 'revoke';
    default:
      return null;                 // BILLING_ISSUE, CANCELLATION, TEST… : on ne touche à rien
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // 1) Authentifie l'appel : le header doit porter notre secret partagé.
  const auth = req.headers.get('Authorization') ?? '';
  if (!SECRET || auth !== `Bearer ${SECRET}`) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as any));
  const ev = body?.event ?? {};
  const type: string = ev.type ?? '';
  const productId: string = (ev.product_id ?? '').split(':')[0]; // Google peut suffixer par :base_plan
  const eventId: string = ev.id ?? ev.transaction_id ?? '';
  // Utilisateur à créditer : l'app_user_id (= id Supabase après logIn). Repli sur original_app_user_id.
  const uid: string = [ev.app_user_id, ev.original_app_user_id].find((u: string) => UUID_RE.test(u ?? '')) ?? '';

  const admin = createClient(URL, SERVICE);

  /* ── 2) ABONNEMENT PREMIUM ────────────────────────────────────────────────────────────────────
     Un même webhook reçoit les abonnements ET les packs consommables : on regarde d'abord si
     l'événement concerne l'entitlement Premium. Deux façons de le reconnaître — l'entitlement
     déclaré par RevenueCat, ou, à défaut, l'identifiant du produit d'abonnement. */
  const entitlements: string[] = Array.isArray(ev.entitlement_ids)
    ? ev.entitlement_ids
    : (ev.entitlement_id ? [ev.entitlement_id] : []);
  const isPremiumEvent = entitlements.includes(PREMIUM_ENTITLEMENT) || PREMIUM_PRODUCTS.includes(productId);
  if (uid && isPremiumEvent) {
    const effect = premiumEffect(type);
    if (!effect) return json({ ok: true, ignored: 'premium_event_neutral' });

    /* Premium OFFERT par un administrateur (`premium_manual`) : jamais retiré par RevenueCat — le
       geste commercial ne dépend pas d'un abonnement. Même règle que celle que portait l'app. */
    const { data: prof, error: profError } = await admin
      .from('profiles').select('is_premium, premium_manual').eq('id', uid).maybeSingle();
    if (profError) return json({ error: profError.message }, 500);
    if (!prof) return json({ ok: true, ignored: 'profile_absent' });
    if (effect === 'revoke' && prof.premium_manual) return json({ ok: true, ignored: 'premium_manual' });

    const wanted = effect === 'grant';
    if (prof.is_premium === wanted) return json({ ok: true, unchanged: true });

    const { error: premiumError } = await admin
      .from('profiles').update({ is_premium: wanted }).eq('id', uid);
    if (premiumError) return json({ error: premiumError.message }, 500);
    return json({ ok: true, premium: wanted });
  }

  // 3) Résout le nombre de requêtes du pack acheté depuis la config (source de vérité).
  const { data: cfg } = await admin.from('ai_config').select('extra_credit_packs').eq('id', 'default').single();
  const packs = (cfg?.extra_credit_packs ?? []) as { product_id: string; credits: number }[];
  const pack = packs.find((p) => p.product_id === productId);

  // 4) Types d'événements « achat consommable ». On crédite ; sur remboursement/annulation on retire.
  const isPurchase = type === 'NON_RENEWING_PURCHASE' || type === 'INITIAL_PURCHASE' || type === 'NON_SUBSCRIPTION_PURCHASE';
  const isRefund = type === 'CANCELLATION' || type === 'REFUND';

  if (!uid || !pack || (!isPurchase && !isRefund)) {
    // Événement non pertinent (abonnement, produit inconnu, user anonyme…) → on acquitte sans rien faire.
    return json({ ok: true, ignored: true });
  }

  const ref = `${eventId || productId}:${isRefund ? 'refund' : 'purchase'}`;
  // 5) Idempotence : si déjà traité (même event), on ne recrédite pas.
  const { data: existing } = await admin.from('ai_extra_credits').select('id').eq('ref', ref).maybeSingle();
  if (existing) return json({ ok: true, duplicate: true });

  const delta = isRefund ? -pack.credits : pack.credits;
  const { error } = await admin.from('ai_extra_credits').insert({
    profile_id: uid, delta, reason: isRefund ? 'refund' : 'purchase', ref,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, credited: delta });
});
