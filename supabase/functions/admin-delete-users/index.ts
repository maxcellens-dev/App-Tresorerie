// ============================================================================
// admin-delete-users — suppression EN MASSE d'utilisateurs par un ADMIN (compte Auth + TOUTES données).
//
// Supprimer l'utilisateur Auth (auth.admin.deleteUser) efface en CASCADE toutes ses données
// (profiles → tables `... REFERENCES profiles(id) ON DELETE CASCADE`). On purge aussi, en best-effort,
// ses fichiers de stockage (avatars/<id>/…).
//
// Sécurité : l'appelant DOIT être admin (is_app_admin sur son JWT). On refuse de supprimer soi-même
// ou un autre admin (re-vérifié côté serveur, jamais confiance au client).
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
const AVATAR_BUCKET = 'avatars';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // 1) Appelant admin ?
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'unauthenticated' }, 401);
  const { data: isAdmin } = await asUser.rpc('is_app_admin');
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
  if (ids.length === 0) return json({ error: 'no_ids' }, 400);
  if (ids.length > 500) return json({ error: 'too_many' }, 400); // garde-fou

  const admin = createClient(URL, SERVICE);

  // 2) Ne jamais supprimer l'appelant ni un autre admin.
  const { data: admins } = await admin.from('profiles').select('id').eq('is_admin', true);
  const adminIds = new Set((admins ?? []).map((a: any) => a.id));
  const targets = ids.filter((id) => id !== user.id && !adminIds.has(id));

  let deleted = 0;
  const errors: { id: string; error: string }[] = [];
  for (const id of targets) {
    // Purge best-effort du stockage (avatars/<id>/…). Ne bloque pas la suppression du compte.
    try {
      const { data: files } = await admin.storage.from(AVATAR_BUCKET).list(id);
      if (files && files.length) {
        await admin.storage.from(AVATAR_BUCKET).remove(files.map((f: any) => `${id}/${f.name}`));
      }
    } catch { /* noop */ }

    const { error } = await admin.auth.admin.deleteUser(id); // CASCADE toutes les données
    if (error) errors.push({ id, error: error.message });
    else deleted++;
  }

  return json({ ok: true, deleted, skipped: ids.length - targets.length, errors });
});
