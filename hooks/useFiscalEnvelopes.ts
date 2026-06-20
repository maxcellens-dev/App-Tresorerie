import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type FiscalEnvelope = 'pea' | 'av' | 'cto' | 'per' | 'autre';

export interface FiscalEnvelopeRate {
  envelope: FiscalEnvelope;
  label: string;
  tax_rate: number;
  sort_order: number;
  note?: string | null;
}

/** Valeurs par défaut (si la table n'est pas encore disponible). */
export const DEFAULT_FISCAL_RATES: FiscalEnvelopeRate[] = [
  { envelope: 'pea', label: 'PEA - Plan Epargne Investissement', tax_rate: 18.6, sort_order: 0, note: 'Taux après 5 ans de détention. Un retrait avant 5 ans est taxé à ~30 % — ajustez le % pour une projection courte.' },
  { envelope: 'av', label: 'Assurance-vie', tax_rate: 18.6, sort_order: 1, note: 'Taux après 8 ans de détention. Avant, la fiscalité est plus élevée — ajustez le % si besoin.' },
  { envelope: 'cto', label: 'CTO - Compte-Titres', tax_rate: 31.4, sort_order: 2, note: 'Flat tax (PFU) sur les plus-values, sans condition de durée.' },
  { envelope: 'per', label: 'PER - Plan Epargne Retraite', tax_rate: 31.4, sort_order: 3, note: 'Taux indicatif sur la sortie en capital du PER. Ajustez-le selon votre situation.' },
  { envelope: 'autre', label: 'Autre', tax_rate: 31.4, sort_order: 4, note: 'Taux appliqué par défaut. Ajustez-le selon votre situation.' },
];

/** Note d'une enveloppe depuis la liste. */
export function noteFor(rates: FiscalEnvelopeRate[], envelope?: string | null): string | null {
  return rates.find((x) => x.envelope === envelope)?.note ?? null;
}

const KEY = 'fiscal_envelope_rates';

export function useFiscalEnvelopeRates() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<FiscalEnvelopeRate[]> => {
      if (!supabase) return DEFAULT_FISCAL_RATES;
      const { data, error } = await supabase
        .from('fiscal_envelope_rates')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error || !data || data.length === 0) return DEFAULT_FISCAL_RATES;
      return data as FiscalEnvelopeRate[];
    },
    staleTime: 1000 * 60 * 10,
  });
}

/** Taux (%) d'une enveloppe depuis la liste. */
export function taxRateFor(rates: FiscalEnvelopeRate[], envelope?: string | null): number {
  const r = rates.find((x) => x.envelope === envelope);
  return r ? r.tax_rate : (rates.find((x) => x.envelope === 'autre')?.tax_rate ?? 31.4);
}

export function useUpdateFiscalRate(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ envelope, tax_rate, label, note }: { envelope: FiscalEnvelope; tax_rate?: number; label?: string; note?: string }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
      if (tax_rate !== undefined) updates.tax_rate = tax_rate;
      if (label !== undefined) updates.label = label;
      if (note !== undefined) updates.note = note;
      const { error } = await supabase
        .from('fiscal_envelope_rates')
        .update(updates)
        .eq('envelope', envelope);
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}
