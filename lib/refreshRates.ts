/**
 * Rafraîchissement des taux de change depuis frankfurter.app (BCE, gratuit, sans clé, base EUR).
 * La réponse donne `rates` = unités par 1 EUR → MÊME convention que notre table currency_rates.
 *
 * Écriture protégée par RLS (`currency_rates_admin_write`) : seul un admin peut upsert. On
 * déclenche donc le refresh quand un ADMIN ouvre l'app et que les taux sont périmés (> ~20 h).
 * La table étant globale, tous les utilisateurs en profitent. (Pour une automatisation 100 %
 * serveur, prévoir une Edge Function planifiée — voir la note dans le suivi multi-devises.)
 */
import { supabase } from './supabase';

const ENDPOINT = 'https://api.frankfurter.app/latest?from=EUR';

export async function refreshCurrencyRates(): Promise<{ updated: number } | null> {
  if (!supabase) return null;
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) return null;
    const json: any = await res.json();
    const rates = json?.rates;
    if (!rates || typeof rates !== 'object') return null;

    const now = new Date().toISOString();
    const rows: { code: string; rate: number; updated_at: string }[] = [
      { code: 'EUR', rate: 1, updated_at: now }, // base : absente de `rates`
    ];
    for (const [code, rate] of Object.entries(rates)) {
      const n = Number(rate);
      if (Number.isFinite(n) && n > 0) rows.push({ code, rate: n, updated_at: now });
    }
    if (rows.length <= 1) return null;

    const { error } = await supabase.from('currency_rates').upsert(rows, { onConflict: 'code' });
    if (error) return null; // non-admin (RLS) ou réseau : on ignore silencieusement
    return { updated: rows.length };
  } catch {
    return null; // hors-ligne / API indisponible : on garde les derniers taux connus
  }
}

/** Vrai si les taux n'ont pas été mis à jour depuis plus de `maxAgeHours`. */
export async function ratesAreStale(maxAgeHours = 20): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('currency_rates')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.updated_at) return true;
  return Date.now() - new Date(data.updated_at).getTime() > maxAgeHours * 3600 * 1000;
}
