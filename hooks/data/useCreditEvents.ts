// Module Crédit — événements (C5) : remboursement anticipé, changement de taux, modulation, frais, pénalité.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { CreditEvent as AmortEvent } from '../../lib/finance/amortization';

export interface CreditEventRow extends AmortEvent {
  id: string;
  credit_id: string;
  note?: string | null;
}

const map = (r: any): CreditEventRow => ({
  id: r.id, credit_id: r.credit_id, date: r.date, kind: r.kind,
  amount: r.amount != null ? Number(r.amount) : null,
  new_rate: r.new_rate != null ? Number(r.new_rate) : null,
  new_payment: r.new_payment != null ? Number(r.new_payment) : null,
  note: r.note ?? null,
});

/** Événements d'UN crédit (écran détail). */
export function useCreditEvents(creditId: string | undefined) {
  return useQuery({
    queryKey: ['credit_events', creditId],
    enabled: !!creditId,
    queryFn: async (): Promise<CreditEventRow[]> => {
      if (!supabase || !creditId) return [];
      const { data, error } = await supabase.from('credit_events').select('*').eq('credit_id', creditId).order('date');
      if (error) throw error;
      return (data ?? []).map(map);
    },
  });
}

/**
 * Tous les événements des crédits auxquels j'ai accès.
 *
 * Un événement créé par un co-emprunteur porte SON `profile_id`. Le filtrer sur mon profil masquait
 * donc son remboursement anticipé dans la trésorerie et la projection, alors que la fiche du crédit
 * (qui lit par `credit_id`) le montrait bien. Le périmètre est donc le CRÉDIT, pas l'auteur.
 *
 * ⚠️ La RLS ne remplace PAS ce filtre. La policy `credit_events_all` (110) est
 * `profile_id = auth.uid() OR credit_can_access(credit_id) OR is_app_admin()` : la branche admin
 * étant OU-ée, un `select('*')` nu rend à un administrateur les événements de TOUS les utilisateurs
 * — téléchargés puis écrits dans le cache react-query persisté de son appareil. On borne donc la
 * lecture aux crédits réellement accessibles, comme le fait `useCredits`.
 */
export function useAllCreditEvents(profileId: string | undefined) {
  return useQuery({
    queryKey: ['credit_events_all', profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Record<string, CreditEventRow[]>> => {
      if (!supabase || !profileId) return {};
      // Crédits accessibles = les miens + ceux dont je suis membre (même règle que `useCredits`).
      // Deux lectures d'identifiants seulement, en parallèle.
      const [ownRes, memRes] = await Promise.all([
        supabase.from('credits').select('id').eq('profile_id', profileId),
        supabase.from('credit_members').select('credit_id').eq('user_id', profileId),
      ]);
      // Erreurs propagées : une lecture ratée n'est pas « aucun crédit ». La renvoyer en liste vide
      // ferait disparaître les remboursements anticipés des flux, sans le moindre signe.
      if (ownRes.error) throw ownRes.error;
      if (memRes.error) throw memRes.error;
      const ids = [...new Set([
        ...((ownRes.data ?? []) as any[]).map((r) => r.id),
        ...((memRes.data ?? []) as any[]).map((r) => r.credit_id),
      ])];
      if (ids.length === 0) return {};
      const { data, error } = await supabase.from('credit_events').select('*').in('credit_id', ids).order('date');
      if (error) throw error;
      const byCredit: Record<string, CreditEventRow[]> = {};
      for (const r of (data ?? [])) (byCredit[r.credit_id] ??= []).push(map(r));
      return byCredit;
    },
  });
}

export function useAddCreditEvent(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { credit_id: string; date: string; kind: CreditEventRow['kind']; amount?: number | null; new_rate?: number | null; new_payment?: number | null; note?: string | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase.from('credit_events').insert({ profile_id: profileId, ...input });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['credit_events', v.credit_id] });
      qc.invalidateQueries({ queryKey: ['credit_events_all', profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteCreditEvent(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; credit_id: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('credit_events').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['credit_events', v.credit_id] });
      qc.invalidateQueries({ queryKey: ['credit_events_all', profileId] });
    },
  });
}
