// Edge Function — refresh-currency-rates
// Met à jour la table `currency_rates` (taux de change) depuis frankfurter.app (BCE, gratuit,
// base EUR → unités par 1 EUR, MÊME convention que la table). Appelée 1×/jour par cron-job.org.
//
// Sécurité : déployée SANS vérif JWT (--no-verify-jwt). On protège l'appel par un secret partagé
// `CRON_SECRET` (header `Authorization: Bearer <secret>`). Sans le bon secret → 401.
//
// Variables d'env :
//   - CRON_SECRET                : à définir (supabase secrets set CRON_SECRET=...)
//   - SUPABASE_URL               : injectée automatiquement par Supabase
//   - SUPABASE_SERVICE_ROLE_KEY  : injectée automatiquement (bypass RLS pour l'upsert)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FRANKFURTER = 'https://api.frankfurter.app/latest?from=EUR';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. Auth : secret partagé avec cron-job.org.
  const secret = Deno.env.get('CRON_SECRET');
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get('x-cron-secret') ??
    '';
  if (!secret || provided !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    // 2. Récupérer les taux (base EUR).
    const res = await fetch(FRANKFURTER);
    if (!res.ok) return json({ error: 'frankfurter unavailable', status: res.status }, 502);
    const data = await res.json();
    const rates = data?.rates;
    if (!rates || typeof rates !== 'object') return json({ error: 'no rates in response' }, 502);

    // 3. Construire les lignes (EUR=1 est absent de `rates`, on l'ajoute).
    const now = new Date().toISOString();
    const rows: Array<{ code: string; rate: number; updated_at: string }> = [
      { code: 'EUR', rate: 1, updated_at: now },
    ];
    for (const [code, rate] of Object.entries(rates)) {
      const n = Number(rate);
      if (Number.isFinite(n) && n > 0) rows.push({ code, rate: n, updated_at: now });
    }

    // 4. Upsert via service role (bypass RLS).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await supabase.from('currency_rates').upsert(rows, { onConflict: 'code' });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, updated: rows.length, date: data.date ?? null });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
