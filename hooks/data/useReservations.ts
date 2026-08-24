import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { Reservation } from '../../types/database';

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
      /* Début du mois LOCAL, exprimé en instant UTC.
         La borne était une simple chaîne « AAAA-MM-01 », que Postgres interprète en UTC face à un
         `timestamptz` : elle ne tombait donc pas au même moment que le mois local de l'utilisateur.
         Une réservation posée le 1ᵉʳ à 00 h 30 à Paris (soit le dernier jour du mois précédent en
         UTC) échappait à cet effacement — la nouvelle s'ajoutait par-dessus, et le « Réservé »
         doublait. Même frontière que la lecture (cf. monthReservationsTotal). */
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      /* Supprimer les réservations du mois courant (non libérées).
         ⚠️ L'erreur DOIT être lue. Cette mutation pose un TOTAL (« baisse-le pour en libérer une
         partie, mets 0 pour tout libérer ») : elle efface puis réinsère. Si l'effacement échouait
         en silence, l'insertion qui suit ajoutait une SECONDE réservation par-dessus l'ancienne —
         le montant « Réservé » du Pilotage doublait, et il est DÉDUIT du Relyka. Et à 0, « tout
         libérer » ne libérait rien tout en affichant un succès. */
      const { error: clearError } = await supabase
        .from('reservations')
        .delete()
        .eq('profile_id', profileId)
        .is('libere_at', null)
        .gte('created_at', monthStart);
      if (clearError) throw clearError;
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
      /* ⚠️ Une lecture EN ÉCHEC ne doit JAMAIS passer pour « aucune réservation » : ces montants sont
         DÉDUITS du Relyka. Les renvoyer à 0 sur une coupure réseau gonflait le budget libre affiché,
         et la modale « Conserver ce mois » — qui pré-remplit le TOTAL réservé à partir de ce chiffre
         — repartait ensuite de ce zéro, effaçant la réservation en cours. On lève : le cache
         précédent reste affiché et react-query réessaie. Même règle que `usePreSavings`. */
      if (error) throw error;
      return ((data ?? []) as Reservation[]).map((r) => ({ ...r, montant: Number(r.montant) }));
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

/**
 * ── MÉNAGE : les réservations d'il y a deux mois et plus ─────────────────────────────────────────
 *
 * Le « Réservé » se remet à zéro chaque mois (seules celles du mois courant sont déduites du
 * Relyka), mais la LIGNE restait en base pour toujours : une réservation morte s'accumulait à chaque
 * mois où l'utilisateur en avait posé une. Elles ne faussaient aucun chiffre — personne ne les
 * lisait — mais elles n'avaient plus aucune raison d'exister.
 *
 * On les marque libérées plutôt que de les supprimer : la trace de ce qui a été mis de côté reste
 * lisible, et une donnée d'argent ne s'efface pas pour faire de la place.
 *
 * ⚠️ Le SEUIL est à M-2, pas au changement de mois : une réservation posée le 28 juillet ne doit pas
 * disparaître le 1ᵉʳ août. La règle elle-même vit dans `staleReservationIds` (lib/pilotageView),
 * testée sans réseau — on ne décide pas d'effacer des données au milieu d'un appel Supabase.
 *
 * Effet de bord discret : un échec ne change rien pour l'utilisateur (les lignes restent, elles ne
 * gênent personne) et ne mérite pas de l'interrompre. Opt-out explicite du backstop d'écriture.
 */
export function useReleaseStaleReservations(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async (ids: string[]) => {
      if (!supabase || !profileId || ids.length === 0) return;
      const { error } = await supabase
        .from('reservations')
        .update({ libere_at: new Date().toISOString() })
        .in('id', ids)
        // Ceinture ET bretelles : la RLS filtre déjà, mais une mise à jour de masse par identifiants
        // ne doit jamais pouvoir sortir du périmètre de son propriétaire.
        .eq('profile_id', profileId)
        .is('libere_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
    },
  });
}
