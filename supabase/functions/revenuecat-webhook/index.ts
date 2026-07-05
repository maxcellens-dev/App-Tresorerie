// Supabase Edge Function — Webhook RevenueCat pour créditer les requêtes IA achetées (click-to-pay).
// Déploiement :
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<un_secret_que_tu_choisis>
//
// Config côté RevenueCat (Dashboard → Project → Integrations → Webhooks) :
//   • URL     : https://<ref>.supabase.co/functions/v1/revenuecat-webhook
//   • Header  : Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>   (le MÊME secret)
//
// Sécurité : le CRÉDIT n'est ajouté QUE par ce webhook (vérifié serveur), jamais par le client → pas de
// triche possible. Idempotent (RevenueCat peut renvoyer un événement) grâce à `ref = event.id`.
//
// L'app fait `Purchases.logIn(<user Supabase>)` → `app_user_id` = l'id du profil à créditer.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

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

  // 2) Résout le nombre de requêtes du pack acheté depuis la config (source de vérité).
  const { data: cfg } = await admin.from('ai_config').select('extra_credit_packs').eq('id', 'default').single();
  const packs = (cfg?.extra_credit_packs ?? []) as { product_id: string; credits: number }[];
  const pack = packs.find((p) => p.product_id === productId);

  // 3) Types d'événements « achat consommable ». On crédite ; sur remboursement/annulation on retire.
  const isPurchase = type === 'NON_RENEWING_PURCHASE' || type === 'INITIAL_PURCHASE' || type === 'NON_SUBSCRIPTION_PURCHASE';
  const isRefund = type === 'CANCELLATION' || type === 'REFUND';

  if (!uid || !pack || (!isPurchase && !isRefund)) {
    // Événement non pertinent (abonnement, produit inconnu, user anonyme…) → on acquitte sans rien faire.
    return json({ ok: true, ignored: true });
  }

  const ref = `${eventId || productId}:${isRefund ? 'refund' : 'purchase'}`;
  // 4) Idempotence : si déjà traité (même event), on ne recrédite pas.
  const { data: existing } = await admin.from('ai_extra_credits').select('id').eq('ref', ref).maybeSingle();
  if (existing) return json({ ok: true, duplicate: true });

  const delta = isRefund ? -pack.credits : pack.credits;
  const { error } = await admin.from('ai_extra_credits').insert({
    profile_id: uid, delta, reason: isRefund ? 'refund' : 'purchase', ref,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, credited: delta });
});
