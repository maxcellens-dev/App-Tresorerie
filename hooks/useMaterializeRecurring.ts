import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { todayISO } from '../lib/dateUtils';

/**
 * Matérialise les occurrences récurrentes échues (≤ aujourd'hui) une fois par session.
 *
 * Appelle la fonction SQL `materialize_due_recurring` (migration 030), qui crée de
 * vraies lignes pour chaque occurrence passée d'une transaction récurrente, ajuste le
 * solde du compte, puis avance la date de départ du modèle au futur (ou le supprime si
 * la récurrence est terminée). L'opération est atomique côté base et idempotente : un
 * second appel ne refait rien tant qu'aucune nouvelle occurrence n'est échue.
 */
export function useMaterializeRecurring(profileId: string | undefined) {
  const client = useQueryClient();
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase || !profileId) return;
    if (ranFor.current === profileId) return;
    ranFor.current = profileId;

    (async () => {
      try {
        // p_today = date LOCALE du client : aligne le « aujourd'hui » du serveur sur celui qui a
        // servi à calculer les soldes côté app (sinon décalage UTC/local près de minuit, cf. 081).
        const today = todayISO();
        const { error } = await supabase.rpc('materialize_due_recurring', { p_profile: profileId, p_today: today });
        if (error) {
          // Permettre une nouvelle tentative au prochain montage (ex. erreur réseau).
          ranFor.current = null;
          return;
        }
        // Porter au solde les dépenses futures non récurrentes devenues échues (migration 044).
        await supabase.rpc('reconcile_posted', { p_profile: profileId, p_today: today });
        client.invalidateQueries({ queryKey: ['transactions', profileId] });
        client.invalidateQueries({ queryKey: ['accounts', profileId] });
        client.invalidateQueries({ queryKey: ['transaction_month_overrides'] });
        client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      } catch {
        ranFor.current = null;
      }
    })();
  }, [profileId, client]);
}
