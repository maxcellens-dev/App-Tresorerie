// ============================================================================
// admin-set-password — Réinitialisation MANUELLE du mot de passe d'un utilisateur par un ADMIN.
//
// Contexte : les comptes e-mail ne sont pas adossés à une vraie messagerie (offre gratuite), donc la
// récupération par lien e-mail n'est pas fiable. Cette fonction permet à un admin de définir un
// nouveau mot de passe pour un utilisateur (identifié par e-mail), via l'API Auth Admin (service role).
//
// Sécurité : l'appelant DOIT être admin (vérifié via is_app_admin() sur son JWT). Le nouveau mot de
// passe est validé (≥ 12, maj/min/chiffre/spécial) côté serveur AUSSI — jamais confiance au client seul.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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

// Doit refléter lib/passwordPolicy.ts (source unique côté client).
function passwordValid(pw: string): boolean {
  return (
    typeof pw === 'string' &&
    pw.length >= 12 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // 1) Authentifier l'appelant et vérifier qu'il est admin.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'unauthenticated' }, 401);
  const { data: isAdmin } = await asUser.rpc('is_app_admin');
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email) return json({ error: 'email_missing' }, 400);
  if (!passwordValid(password)) return json({ error: 'weak_password' }, 400);

  const admin = createClient(URL, SERVICE);

  // 2) Retrouver l'utilisateur cible par e-mail (profiles = miroir de auth.users).
  const { data: prof } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (!prof?.id) return json({ error: 'user_not_found' }, 404);

  // 3) Définir le nouveau mot de passe via l'API Auth Admin.
  const { error } = await admin.auth.admin.updateUserById(prof.id as string, { password });
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true });
});
