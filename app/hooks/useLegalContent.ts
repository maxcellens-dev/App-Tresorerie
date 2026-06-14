/**
 * Contenu légal éditable (§P9) — app_config.legal { privacy, legal }.
 * Si une clé est vide, l'écran correspondant affiche son contenu par défaut (codé en dur).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const KEY = 'legal_content';

export interface LegalContent { privacy?: string; legal?: string }

export function useLegalContent() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<LegalContent> => {
      if (!supabase) return {};
      const { data } = await supabase.from('app_config').select('legal').eq('id', 'default').maybeSingle();
      return ((data as any)?.legal as LegalContent) ?? {};
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveLegalContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: LegalContent) => {
      if (!supabase) throw new Error('Supabase non configuré');
      const { error } = await supabase.from('app_config').update({ legal: content, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return content;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
