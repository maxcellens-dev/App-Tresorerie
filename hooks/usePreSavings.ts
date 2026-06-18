import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PreSaving, PreSavingType, PreSavingEntry } from '../types/database';

const KEY = 'pre_savings';

function emptyPreSaving(type: PreSavingType): PreSaving {
  return { id: '', profile_id: '', type, total_cumule: 0, entrees: [], statut: 'actif', updated_at: '' };
}

export interface PreSavingsState {
  epargne: PreSaving;
  invest: PreSaving;
}

/** Renvoie les cumuls pré-épargne et pré-invest (lignes par défaut à 0 si absentes). */
export function usePreSavings(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<PreSavingsState> => {
      const result: PreSavingsState = { epargne: emptyPreSaving('epargne'), invest: emptyPreSaving('invest') };
      if (!supabase || !profileId) return result;
      const { data, error } = await supabase
        .from('pre_savings')
        .select('*')
        .eq('profile_id', profileId);
      if (error || !data) return result;
      for (const row of data as PreSaving[]) {
        if (row.type === 'epargne') result.epargne = { ...row, total_cumule: Number(row.total_cumule), entrees: row.entrees ?? [] };
        if (row.type === 'invest') result.invest = { ...row, total_cumule: Number(row.total_cumule), entrees: row.entrees ?? [] };
      }
      return result;
    },
    enabled: !!profileId,
  });
}

/** Ajoute une entrée au cumul (upsert : crée la ligne ou incrémente le total). */
export function useAddPreSavingEntry(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, montant, note }: { type: PreSavingType; montant: number; note?: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: existing } = await supabase
        .from('pre_savings')
        .select('*')
        .eq('profile_id', profileId)
        .eq('type', type)
        .maybeSingle();

      const entry: PreSavingEntry = { date: new Date().toISOString(), montant, note };

      if (existing) {
        const prev = existing as PreSaving;
        const entrees = [...(prev.entrees ?? []), entry];
        const { error } = await supabase
          .from('pre_savings')
          .update({ total_cumule: Number(prev.total_cumule) + montant, entrees, updated_at: new Date().toISOString() })
          .eq('id', prev.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pre_savings')
          .insert({ profile_id: profileId, type, total_cumule: montant, entrees: [entry], statut: 'actif' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Remet un cumul à 0 (total + entrées). */
export function useResetPreSaving(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (type: PreSavingType) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('pre_savings')
        .update({ total_cumule: 0, entrees: [], statut: 'actif', updated_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        .eq('type', type);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Met à jour le statut d'un cumul (actif / en_depassement). */
export function useSetPreSavingStatus(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, statut }: { type: PreSavingType; statut: 'actif' | 'en_depassement' }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('pre_savings')
        .update({ statut, updated_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        .eq('type', type);
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY, profileId] }); },
  });
}
