// Supabase Edge Function — Conseils IA (Lot A2).
// Déploiement :
//   supabase secrets set GEMINI_API_KEY=ta_cle
//   supabase functions deploy ai-advice
// La clé API n'apparaît JAMAIS côté client. Cette fonction : authentifie le user, vérifie le quota
// (mois) + le cap global (jour), assemble le prompt (template admin + instantané fourni par le client,
// déjà anonymisé), interroge Gemini avec BASCULE de modèles, stocke l'historique, crée un ticket si échec.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')!;

// Notifie les admins (push Expo) qu'un conseil IA a échoué et attend une relance.
async function notifyAdmins(admin: any, body: string) {
  try {
    const { data: admins } = await admin.from('profiles').select('id').eq('is_admin', true);
    const ids = (admins ?? []).map((a: any) => a.id);
    if (!ids.length) return;
    const { data: toks } = await admin.from('push_tokens').select('token').in('profile_id', ids);
    const tokens = [...new Set((toks ?? []).map((t: any) => t.token))].filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
    if (!tokens.length) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title: 'Conseils IA — ticket', body, sound: 'default' }))),
    });
  } catch { /* best effort */ }
}

async function callGemini(model: string, prompt: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  if (!text.trim()) throw new Error('empty response');
  return text.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // 1) Qui est le user (via son JWT) ?
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'unauthenticated' }, 401);

  const admin = createClient(URL, SERVICE); // bypass RLS (lecture data + écriture historique)
  const body = await req.json().catch(() => ({}));
  const kind: string = body.kind === 'analysis' ? 'analysis' : 'chat';
  const analysisKey: string | null = kind === 'analysis' ? String(body.analysis_key ?? '') : null;
  const question: string = kind === 'chat' ? String(body.question ?? '').slice(0, 2000) : '';
  const snapshot: string = String(body.snapshot ?? '').slice(0, 20000);
  const wantedModel: string | undefined = body.model || undefined; // choix éventuel du user

  // ── Relance ADMIN : l'admin rejoue une requête échouée pour un user cible, SANS quota ni décompte.
  const adminRelaunch = body.admin_relaunch === true;
  if (adminRelaunch) {
    // is_app_admin() s'évalue sur auth.uid() = l'appelant → on le vérifie via le client authentifié.
    const { data: callerIsAdmin } = await asUser.rpc('is_app_admin');
    if (!callerIsAdmin) return json({ error: 'forbidden' }, 403);
    const targetUser: string = String(body.target_user ?? '');
    if (!targetUser) return json({ error: 'target_missing' }, 400);
    const akey = kind === 'analysis' ? analysisKey! : 'chat_system';
    const { data: pr } = await admin.from('ai_prompts').select('prompt_template').eq('key', akey).maybeSingle();
    if (!pr) return json({ error: 'prompt_missing' }, 500);
    const fp = pr.prompt_template.replaceAll('{{SNAPSHOT}}', snapshot).replaceAll('{{QUESTION}}', question);
    const { data: acfg } = await admin.from('ai_config').select('models').single();
    let rep = '', mdl = '', le = '';
    for (const m of (acfg!.models as any[]).filter((x) => x.enabled)) {
      try { rep = await callGemini(m.id, fp); mdl = m.id; break; } catch (e) { le = String(e); }
    }
    if (!rep) return json({ ok: false, queued: true, error: le });
    await admin.from('ai_messages').insert({ profile_id: targetUser, role: 'assistant', content: rep, model: mdl });
    if (body.ticket_id) await admin.from('ai_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', body.ticket_id);
    return json({ ok: true, reply: rep, model: mdl });
  }

  // 2) Config + droit d'accès + quota.
  const [{ data: cfg }, { data: featRow }, { data: profile }] = await Promise.all([
    admin.from('ai_config').select('*').eq('id', 'default').single(),
    admin.from('app_config').select('features').eq('id', 'default').maybeSingle(),
    admin.from('profiles').select('is_premium').eq('id', user.id).single(),
  ]);
  if (!cfg) return json({ error: 'config' }, 500);
  const features = (featRow?.features ?? {}) as Record<string, unknown>;
  // Le bouton est toujours visible côté app ; l'ACCÈS réel = Premium OU « Ouvrir à tous ».
  const premiumEnabled = !!features.premium_enabled;
  const isPremium = premiumEnabled && !!profile?.is_premium;
  if (!cfg.open_to_all && !isPremium) return json({ error: 'premium_required' }, 403);

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const limit = isPremium ? cfg.premium_monthly_limit : cfg.free_monthly_limit;
  const { count: used } = await admin.from('ai_messages').select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id).eq('role', 'user').eq('counted', true).gte('created_at', monthStart);
  if ((used ?? 0) >= limit) return json({ error: 'quota_exceeded', used, limit }, 429);

  // 3) Prompt : template admin + instantané (déjà anonymisé côté client).
  const key = kind === 'analysis' ? analysisKey! : 'chat_system';
  const { data: prompt } = await admin.from('ai_prompts').select('prompt_template, title').eq('key', key).maybeSingle();
  if (!prompt) return json({ error: 'prompt_missing' }, 500);
  const finalPrompt = prompt.prompt_template
    .replaceAll('{{SNAPSHOT}}', snapshot)
    .replaceAll('{{QUESTION}}', question);
  const userContent = kind === 'analysis' ? `📊 ${prompt.title}` : question;

  // 4) Trace le message user (non décompté tant qu'on n'a pas de réponse).
  const { data: userMsg } = await admin.from('ai_messages')
    .insert({ profile_id: user.id, role: 'user', content: userContent, kind, analysis_key: analysisKey, counted: false })
    .select('id').single();

  // 5) Cap global du jour (garde-fou quota gratuit Gemini). Dépassé → on file en mode « ticket ».
  const { count: globalToday } = await admin.from('ai_messages').select('id', { count: 'exact', head: true })
    .eq('role', 'assistant').gte('created_at', dayStart);
  const overGlobal = (globalToday ?? 0) >= cfg.daily_global_cap;

  // 6) Appel modèle avec bascule (modèle choisi en tête s'il est fourni & actif).
  let reply = '', modelUsed = '', lastErr = '';
  let models = (cfg.models as any[]).filter((m) => m.enabled);
  if (wantedModel) models = [...models.filter((m) => m.id === wantedModel), ...models.filter((m) => m.id !== wantedModel)];
  if (!overGlobal) {
    for (const m of models) {
      try { reply = await callGemini(m.id, finalPrompt); modelUsed = m.id; break; }
      catch (e) { lastErr = String(e); }
    }
  } else { lastErr = 'daily_global_cap'; }

  // 7a) Échec → ticket admin (relance gratuite plus tard), le user sera notifié. Pas de décompte.
  if (!reply) {
    await admin.from('ai_tickets').insert({
      profile_id: user.id, user_message_id: userMsg?.id ?? null,
      request: { kind, analysis_key: analysisKey, question, snapshot }, error: lastErr, status: 'open',
    });
    await notifyAdmins(admin, 'Une demande de conseil a échoué et attend une relance.');
    return json({ ok: false, queued: true });
  }

  // 7b) Succès → réponse + décompte de la requête user.
  await admin.from('ai_messages').insert({ profile_id: user.id, role: 'assistant', content: reply, model: modelUsed });
  await admin.from('ai_messages').update({ counted: true }).eq('id', userMsg!.id);
  return json({ ok: true, reply, model: modelUsed, used: (used ?? 0) + 1, limit });
});
