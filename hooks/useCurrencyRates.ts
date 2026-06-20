/**
 * useCurrencyRates — taux de change (code → unités pour 1 EUR), pour convertir entre devises.
 * Lus depuis la table currency_rates (migration 087), rafraîchis quotidiennement (Phase 2).
 * Repli : EUR=1 si la table est indisponible (évite un crash ; la conversion renverra null pour
 * les autres devises → l'UI affiche « ≈ ? » au lieu d'un montant faux).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { RatesMap } from '../lib/currency';

const KEY = 'currency_rates';

export function useCurrencyRates() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<RatesMap> => {
      if (!supabase) return { EUR: 1 };
      const { data, error } = await supabase.from('currency_rates').select('code, rate');
      if (error || !data || data.length === 0) return { EUR: 1 };
      const map: RatesMap = {};
      for (const r of data as { code: string; rate: number }[]) map[r.code] = Number(r.rate);
      if (!map.EUR) map.EUR = 1;
      return map;
    },
    staleTime: 1000 * 60 * 60, // 1 h : les taux bougent peu en intra-journée
  });
}
