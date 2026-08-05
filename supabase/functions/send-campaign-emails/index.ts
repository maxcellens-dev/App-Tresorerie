// ============================================================================
// send-campaign-emails — envoi d'une campagne e-mail Relyka via l'API Brevo.
//
// Deux façons de l'appeler :
//   • ADMIN, avec { campaign_id } → envoie CETTE campagne (bouton « Envoyer maintenant ») ;
//   • CRON, avec le secret partagé (`Authorization: Bearer <CRON_SECRET>` ou `X-Cron-Secret`) →
//     envoie toutes les campagnes `scheduled` dont l'heure est passée. C'est ce qui rend la
//     programmation possible sans serveur dédié.
//
// ⚠️ À DÉPLOYER SANS VÉRIF JWT (`--no-verify-jwt`, cf. README) : sinon la passerelle Supabase
// renvoie 401 AVANT d'exécuter la fonction, puisque le secret du cron n'est pas un JWT valide.
//
// Sécurité : la clé Brevo ne quitte JAMAIS le serveur (secret Edge Function). L'appelant humain
// doit être admin — re-vérifié ici, jamais sur la foi du client.
//
// Secrets attendus (Dashboard → Project Settings → Edge Functions → Secrets) :
//   BREVO_API_KEYS (ou BREVO_API_KEY), BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, PUBLIC_APP_URL, CRON_SECRET
//
// Plusieurs clés Brevo : voir `parseKeys()` plus bas. Quand une clé atteint son quota journalier,
// l'envoi BASCULE tout seul sur la suivante et le lot repart — la campagne ne s'arrête plus au
// 300ᵉ e-mail.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// Gabarit PARTAGÉ avec l'aperçu de l'écran admin : une seule définition du rendu, donc un aperçu
// qui montre vraiment ce qui part.
import { renderRelykaEmail } from '../_shared/emailTemplate.ts';
import { brevoKeys, type BrevoKey } from '../_shared/brevoKeys.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'contact@relyka.app';
const SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') ?? 'Relyka';
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://relyka.app').replace(/\/$/, '');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

// ── Clés Brevo : PLUSIEURS, essayées à la suite ─────────────────────────────────────────────────
// Un compte Brevo gratuit est plafonné à ~300 e-mails PAR JOUR. Au-delà, l'API répond 402
// `not_enough_credits` et la campagne échoue au milieu. Empiler plusieurs clés permet de reprendre
// l'envoi là où il s'est arrêté, avec le compte suivant, sans intervention.
//
// `BREVO_API_KEY` (la clé historique) et `BREVO_API_KEYS` (les suivantes) s'ADDITIONNENT — voir
// `_shared/brevoKeys.ts` pour le pourquoi (une clé Brevo n'est jamais réaffichée après création).
const BREVO_KEYS = brevoKeys(SENDER_EMAIL, SENDER_NAME);

/** Codes HTTP qui signifient « cette clé ne peut plus envoyer, essaie la suivante ». */
function shouldRotate(status: number, bodyText: string): boolean {
  if (status === 402 || status === 429) return true;              // quota épuisé / cadence dépassée
  if (status === 401 || status === 403) return true;              // clé invalide ou révoquée
  return /not_enough_credits|quota|limit.?exceed/i.test(bodyText); // filet : Brevo varie sur les codes
}

/**
 * Brevo limite chaque appel `messageVersions` à 1000 destinataires — mais la taille du lot est ici
 * dictée par le QUOTA, pas par la limite d'API : un compte gratuit dispose d'environ 300 e-mails par
 * jour. Un lot de 500 dépasserait à lui seul le quota d'un compte neuf, donc TOUTES les clés le
 * refuseraient et rien ne partirait. À 100, chaque clé écoule ce qu'elle peut avant de passer la main.
 */
const BATCH = 100;

const renderEmail = (subject: string, body: string, unsubUrl: string) =>
  renderRelykaEmail({ subject, body, unsubUrl, appUrl: APP_URL });

interface Recipient { id: string; email: string; name: string | null; token: string }

/** Signalé quand toutes les clés sont à sec : ce n'est pas un échec, c'est une PAUSE. */
class QuotaExhausted extends Error {}

/**
 * Curseur de clé COURANTE, partagé par tous les lots d'une même exécution : une fois qu'une clé est
 * épuisée, les lots suivants ne repassent pas par elle pour se faire refuser à nouveau.
 * (Il repart à 0 à chaque démarrage de l'instance — ce n'est pas un compteur de quota, juste un
 * raccourci ; le quota réel, seul Brevo le connaît, et il se redit à chaque refus.)
 */
let keyCursor = 0;

async function sendBatch(subject: string, body: string, people: Recipient[]): Promise<void> {
  if (!BREVO_KEYS.length) throw new Error('Aucune clé Brevo configurée (BREVO_API_KEYS)');
  const payloadFor = (k: BrevoKey) => JSON.stringify({
    sender: { email: k.sender, name: k.name },
    subject,
    htmlContent: renderEmail(subject, body, `${APP_URL}/desinscription`),
    // `messageVersions` : un seul appel API, mais un contenu PROPRE à chaque destinataire — c'est ce
    // qui permet d'avoir un lien de désinscription individuel (et pas un lien générique inutilisable).
    messageVersions: people.map((p) => ({
      to: [{ email: p.email, name: p.name ?? undefined }],
      htmlContent: renderEmail(subject, body, `${APP_URL}/desinscription?t=${p.token}`),
    })),
  });

  const attempts: string[] = [];
  // On essaie CHAQUE clé au plus une fois, en repartant de la dernière qui fonctionnait.
  for (let n = 0; n < BREVO_KEYS.length; n++) {
    const idx = (keyCursor + n) % BREVO_KEYS.length;
    const k = BREVO_KEYS[idx];
    let res: Response;
    try {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': k.key, 'content-type': 'application/json', accept: 'application/json' },
        body: payloadFor(k),
      });
    } catch (e) {
      attempts.push(`clé #${idx + 1} : réseau — ${String(e).slice(0, 120)}`);
      continue;
    }
    if (res.ok) { keyCursor = idx; return; }          // cette clé marche : les lots suivants la garderont
    const text = (await res.text()).slice(0, 300);
    attempts.push(`clé #${idx + 1} : HTTP ${res.status} — ${text}`);
    if (!shouldRotate(res.status, text)) {
      // Erreur qui ne vient PAS de la clé (contenu refusé, destinataire invalide…) : changer de compte
      // ne changerait rien, et réessayer enverrait des doublons à ceux que le lot a déjà servis.
      throw new Error(`Brevo ${res.status} : ${text}`);
    }
    console.warn(`[send-campaign] clé #${idx + 1} écartée (HTTP ${res.status}), bascule sur la suivante.`);
  }
  /* Toutes les clés ont refusé le lot. C'est presque toujours le quota journalier : on le remonte
     comme une PAUSE et non comme un échec — la campagne reprendra d'elle-même. */
  throw new QuotaExhausted(
    BREVO_KEYS.length > 1
      ? `Les ${BREVO_KEYS.length} clés Brevo ont refusé le lot. ${attempts.join(' | ')}`
      : attempts[0] ?? 'Envoi Brevo impossible',
  );
}

/** Délai avant reprise d'une campagne mise en pause (quota épuisé). */
const RESUME_DELAY_MS = 60 * 60 * 1000;

async function runCampaign(admin: ReturnType<typeof createClient>, campaignId: string) {
  const { data: c, error } = await admin.from('email_campaigns').select('*').eq('id', campaignId).single();
  if (error || !c) throw new Error('Campagne introuvable');
  // `paused` est repris ; `sending` (déjà en cours ailleurs) et `sent` (terminé) ne le sont pas.
  if (c.status === 'sending' || c.status === 'sent') return { skipped: true, sent: 0, paused: false, remaining: 0 };

  await admin.from('email_campaigns').update({ status: 'sending', error: null }).eq('id', campaignId);

  try {
    // Destinataires : opt-in + adresse renseignée, filtrés par audience.
    let q = admin.from('profiles').select('id, email, full_name, is_premium, email_unsub_token')
      .eq('email_opt_in', true).not('email', 'is', null);
    if (c.audience === 'premium') q = q.eq('is_premium', true);
    if (c.audience === 'free') q = q.or('is_premium.is.null,is_premium.eq.false');
    const { data: rows, error: readErr } = await q;
    if (readErr) throw readErr;

    let people = (rows ?? []) as any[];
    if (c.audience === 'group' && c.group_id) {
      const { data: members } = await admin.from('user_group_members').select('profile_id').eq('group_id', c.group_id);
      const ids = new Set((members ?? []).map((m: any) => m.profile_id));
      people = people.filter((p) => ids.has(p.id));
    }
    const audience: Recipient[] = people
      .filter((p) => typeof p.email === 'string' && p.email.includes('@'))
      .map((p) => ({ id: p.id, email: p.email, name: p.full_name ?? null, token: p.email_unsub_token }));

    /* REPRISE — on retire les destinataires DÉJÀ SERVIS (migration 168). C'est ce registre, et pas
       un compteur de position, qui rend la reprise exacte : entre deux jours, des comptes se créent
       et d'autres se désinscrivent, donc « repartir de l'indice 300 » sauterait ou dupliquerait des
       gens. Ici on envoie à « tout le monde SAUF ceux qui ont déjà reçu ». */
    const { data: already, error: sentErr } = await admin
      .from('email_campaign_sends').select('profile_id').eq('campaign_id', campaignId);
    if (sentErr) throw sentErr;
    const servedIds = new Set((already ?? []).map((r: any) => r.profile_id));
    const recipients = audience.filter((r) => !servedIds.has(r.id));

    // Total visé = les déjà servis + ce qu'il reste. Affiché tel quel comme avancement.
    const total = servedIds.size + recipients.length;
    await admin.from('email_campaigns').update({ total_recipients: total }).eq('id', campaignId);

    let sent = 0;
    let quotaHit: string | null = null;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH);
      try {
        await sendBatch(c.subject, c.body, slice);
      } catch (e) {
        // Quota épuisé : on s'arrête PROPREMENT ici, on ne perd rien, on reprendra plus tard.
        if (e instanceof QuotaExhausted) { quotaHit = e.message; break; }
        throw e;   // toute autre erreur reste un échec
      }
      /* Le registre est écrit APRÈS l'acceptation du lot par Brevo. Dans l'autre sens, un plantage
         entre les deux ferait passer des gens pour servis alors qu'ils n'ont rien reçu — et ils
         seraient définitivement sautés. Ici, le pire cas est un doublon sur un lot, pas un oubli. */
      const { error: ledgerErr } = await admin.from('email_campaign_sends')
        .upsert(slice.map((r) => ({ campaign_id: campaignId, profile_id: r.id })), { onConflict: 'campaign_id,profile_id' });
      if (ledgerErr) console.warn('[send-campaign] registre non écrit (risque de doublon à la reprise):', ledgerErr.message);
      sent += slice.length;
    }

    const totalServed = servedIds.size + sent;

    if (quotaHit) {
      /* PAUSE, pas échec : la campagne reprendra toute seule. Une heure plus tard plutôt qu'à
         minuit — on ne sait pas à quelle heure exacte Brevo remet les compteurs à zéro, et un essai
         horaire coûte un appel d'API. Si le quota n'est toujours pas revenu, elle se remet en pause. */
      const resumeAt = new Date(Date.now() + RESUME_DELAY_MS).toISOString();
      await admin.from('email_campaigns').update({
        status: 'paused', resume_at: resumeAt,
        recipients_count: totalServed, total_recipients: total,
        error: `Quota d'envoi atteint après ${totalServed}/${total} destinataires. Reprise automatique après ${new Date(resumeAt).toLocaleString('fr-FR')}. ${quotaHit}`,
      }).eq('id', campaignId);
      return { skipped: false, sent, paused: true, remaining: total - totalServed };
    }

    await admin.from('email_campaigns').update({
      status: 'sent', sent_at: new Date().toISOString(),
      recipients_count: totalServed, total_recipients: total, resume_at: null, error: null,
    }).eq('id', campaignId);
    return { skipped: false, sent, paused: false, remaining: 0 };
  } catch (e) {
    // L'échec est ÉCRIT : une campagne qui n'est jamais partie doit se voir dans l'écran admin,
    // pas seulement dans les logs.
    await admin.from('email_campaigns').update({
      status: 'failed', error: e instanceof Error ? e.message : String(e),
    }).eq('id', campaignId);
    throw e;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!BREVO_KEYS.length) return json({ error: 'Aucune clé Brevo côté serveur (BREVO_API_KEYS ou BREVO_API_KEY)' }, 500);

  const admin = createClient(URL_, SERVICE);
  // Le secret CRON est accepté sur les DEUX en-têtes : `X-Cron-Secret`, et `Authorization: Bearer`
  // comme les autres crons du projet (send-scheduled-notifications, refresh-currency-rates) — c'est
  // le seul en-tête que beaucoup d'ordonnanceurs savent envoyer. Un JWT utilisateur ne peut pas
  // valoir CRON_SECRET, donc l'appel admin plus bas n'est pas affecté.
  const cronHeader = req.headers.get('x-cron-secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? '';

  // ── Appel CRON : envoie tout ce qui est dû. Toute méthode acceptée (les ordonnanceurs
  //    appellent souvent en GET) — le contrôle, c'est le secret. ──
  if (CRON_SECRET && cronHeader === CRON_SECRET) {
    const now = new Date().toISOString();
    // Campagnes PROGRAMMÉES dont l'heure est passée…
    const { data: scheduled } = await admin.from('email_campaigns')
      .select('id').eq('status', 'scheduled').lte('scheduled_at', now);
    // …et campagnes EN PAUSE dont l'heure de reprise est atteinte (migration 168). Sans cette
    // seconde lecture, une campagne étalée sur deux jours ne repartirait jamais toute seule.
    const { data: resumable } = await admin.from('email_campaigns')
      .select('id').eq('status', 'paused').lte('resume_at', now);

    const due = [...(scheduled ?? []), ...(resumable ?? [])] as any[];
    let total = 0;
    let paused = 0;
    const errors: string[] = [];
    for (const c of due) {
      try {
        const r = await runCampaign(admin, c.id);
        total += r.sent;
        if (r.paused) paused++;
      } catch (e) { errors.push(`${c.id}: ${e instanceof Error ? e.message : e}`); }
    }
    return json({ ok: true, campaigns: due.length, sent: total, paused, errors });
  }

  // ── Appel ADMIN (bouton « Envoyer maintenant »). ──
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'unauthenticated' }, 401);
  const { data: isAdmin } = await asUser.rpc('is_app_admin');
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id : '';
  if (!campaignId) return json({ error: 'campaign_id requis' }, 400);

  try {
    const r = await runCampaign(admin, campaignId);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
