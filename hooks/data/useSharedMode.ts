// Mode « périmètre quotidien » du USER COURANT pour un compte partagé (Contribution / Suivi partagé).
// Owner → accounts.shared_mode ; membre → account_members.shared_mode. Réglé via RPC acct_set_shared_mode.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { SharedMode } from '../../lib/finance/perimeter';

export function useMySharedMode(accountId: string | undefined, profileId: string | undefined) {
  return useQuery({
    queryKey: ['my_shared_mode', accountId, profileId],
    enabled: !!accountId && !!profileId && !!supabase,
    queryFn: async (): Promise<SharedMode | null> => {
      const { data: acc } = await supabase!
        .from('accounts').select('profile_id, shared_mode').eq('id', accountId!).maybeSingle();
      if (!acc) return null;
      if ((acc as any).profile_id === profileId) return ((acc as any).shared_mode ?? null) as SharedMode | null;
      const { data: mem } = await supabase!
        .from('account_members').select('shared_mode').eq('account_id', accountId!).eq('user_id', profileId!).maybeSingle();
      return ((mem as any)?.shared_mode ?? null) as SharedMode | null;
    },
  });
}

export function useSetSharedMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { accountId: string; mode: SharedMode }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('acct_set_shared_mode', { p_account: input.accountId, p_mode: input.mode });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_shared_mode'] });
      qc.invalidateQueries({ queryKey: ['shared_contribution'] });
      qc.invalidateQueries({ queryKey: ['pilotage_data'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
