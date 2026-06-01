import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Reservation } from '../types/database';

const KEY = 'reservations';

/**
 * Définit le montant conservé du MOIS COURANT (pas de cumul) : remplace les
 * réservations du mois en cours par une seule, du montant total validé.
 * Le montant conservé se réinitialise naturellement chaque mois (on ne compte
 * que les réservations créées dans le mois courant côté Pilotage).
 */
export function useSetMonthlyReservation(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ montant, libelle }: { montant: number; libelle?: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      // Supprimer les réservations du mois courant (non libérées)
      await supabase
        .from('reservations')
        .delete()
        .eq('profile_id', profileId)
        .is('libere_at', null)
        .gte('created_at', monthStart);
      // Insérer la nouvelle réservation du mois (si montant > 0)
      if (montant > 0) {
        const { error } = await supabase
          .from('reservations')
          .insert({ profile_id: profileId, montant, libelle: libelle ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Réservations actives (non libérées) de l'utilisateur. */
export function useReservations(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Reservation[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .eq('profile_id', profileId)
        .is('libere_at', null)
        .order('created_at', { ascending: false });
      if (error || !data) return [];
      return (data as Reservation[]).map((r) => ({ ...r, montant: Number(r.montant) }));
    },
    enabled: !!profileId,
  });
}

export function useAddReservation(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ montant, libelle }: { montant: number; libelle?: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('reservations')
        .insert({ profile_id: profileId, montant, libelle: libelle ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Libère une réservation (la réintègre au reste disponible). */
export function useReleaseReservation(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('reservations')
        .update({ libere_at: new Date().toISOString() })
        .eq('id', id)
        .eq('profile_id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
