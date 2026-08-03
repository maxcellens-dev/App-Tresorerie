// ============================================================================
// send-campaign-emails — envoi d'une campagne e-mail Relyka via l'API Brevo.
//
// Deux façons de l'appeler :
//   • ADMIN, avec { campaign_id } → envoie CETTE campagne (bouton « Envoyer maintenant ») ;
//   • CRON, avec l'en-tête X-Cron-Secret → envoie toutes les campagnes `scheduled` dont l'heure
//     est passée. C'est ce qui rend la programmation possible sans serveur dédié.
//
// Sécurité : la clé Brevo ne quitte JAMAIS le serveur (secret Edge Function). L'appelant humain
// doit être admin — re-vérifié ici, jamais sur la foi du client.
//
// Secrets attendus (Dashboard → Project Settings → Edge Functions → Secrets) :
//   BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, PUBLIC_APP_URL, CRON_SECRET
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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
const BREVO_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'contact@relyka.app';
const SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') ?? 'Relyka';
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://relyka.app').replace(/\/$/, '');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

/** Brevo limite chaque appel `messageVersions` à 1000 destinataires. */
const BATCH = 500;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Gabarit Relyka — l'admin écrit du texte, jamais du HTML. Les sauts de ligne deviennent des
 * paragraphes, et le pied de page porte le lien de désinscription (obligatoire, un par destinataire).
 */
function renderEmail(subject: string, body: string, unsubUrl: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#2f3a37;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 12px rgba(13,46,42,.08);">
        <tr><td style="background:#0D2E2A;padding:28px 32px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">Relyka</div>
          <div style="font-size:12px;color:#8FD8C4;margin-top:4px;">Ton argent, au clair</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 20px;font-size:20px;line-height:28px;color:#0D2E2A;font-weight:800;">${esc(subject)}</h1>
          ${paragraphs}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
            <tr><td style="background:#00B67A;border-radius:12px;">
              <a href="${APP_URL}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Ouvrir Relyka</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #EAE4DA;">
          <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#7A8783;">
            Tu reçois cet e-mail parce que tu as un compte Relyka.
          </p>
          <p style="margin:0;font-size:12px;line-height:18px;color:#7A8783;">
            <a href="${unsubUrl}" style="color:#7A8783;text-decoration:underline;">Ne plus recevoir ces e-mails</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/confidentialite" style="color:#7A8783;text-decoration:underline;">Confidentialité</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

interface Recipient { email: string; name: string | null; token: string }

async function sendBatch(subject: string, body: string, people: Recipient[]): Promise<void> {
  // `messageVersions` : un seul appel API, mais un contenu PROPRE à chaque destinataire — c'est ce
  // qui permet d'avoir un lien de désinscription individuel (et pas un lien générique inutilisable).
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      htmlContent: renderEmail(subject, body, `${APP_URL}/desinscription`),
      messageVersions: people.map((p) => ({
        to: [{ email: p.email, name: p.name ?? undefined }],
        htmlContent: renderEmail(subject, body, `${APP_URL}/desinscription?t=${p.token}`),
      })),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status} : ${(await res.text()).slice(0, 300)}`);
}

async function runCampaign(admin: ReturnType<typeof createClient>, campaignId: string) {
  const { data: c, error } = await admin.from('email_campaigns').select('*').eq('id', campaignId).single();
  if (error || !c) throw new Error('Campagne introuvable');
  if (c.status === 'sending' || c.status === 'sent') return { skipped: true, sent: 0 };

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
    const recipients: Recipient[] = people
      .filter((p) => typeof p.email === 'string' && p.email.includes('@'))
      .map((p) => ({ email: p.email, name: p.full_name ?? null, token: p.email_unsub_token }));

    for (let i = 0; i < recipients.length; i += BATCH) {
      await sendBatch(c.subject, c.body, recipients.slice(i, i + BATCH));
    }

    await admin.from('email_campaigns').update({
      status: 'sent', sent_at: new Date().toISOString(), recipients_count: recipients.length,
    }).eq('id', campaignId);
    return { skipped: false, sent: recipients.length };
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
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!BREVO_KEY) return json({ error: 'BREVO_API_KEY manquant côté serveur' }, 500);

  const admin = createClient(URL_, SERVICE);
  const cronHeader = req.headers.get('x-cron-secret') ?? '';

  // ── Appel CRON : envoie tout ce qui est dû. ──
  if (CRON_SECRET && cronHeader === CRON_SECRET) {
    const { data: due } = await admin.from('email_campaigns')
      .select('id').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString());
    let total = 0;
    const errors: string[] = [];
    for (const c of (due ?? []) as any[]) {
      try { total += (await runCampaign(admin, c.id)).sent; }
      catch (e) { errors.push(`${c.id}: ${e instanceof Error ? e.message : e}`); }
    }
    return json({ ok: true, campaigns: (due ?? []).length, sent: total, errors });
  }

  // ── Appel ADMIN. ──
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
