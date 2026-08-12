import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { todayISO } from '../../lib/dateUtils';

/**
 * Matérialise les occurrences récurrentes échues (≤ aujourd'hui) une fois par session.
 *
 * Appelle la fonction SQL `materialize_due_recurring` (migration 030), qui crée de
 * vraies lignes pour chaque occurrence passée d'une transaction récurrente, ajuste le
 * solde du compte, puis avance la date de départ du modèle au futur (ou le supprime si
 * la récurrence est terminée). L'opération est atomique côté base et idempotente : un
 * second appel ne refait rien tant qu'aucune nouvelle occurrence n'est échue.
 *
 * ⚠️ PERF (ouverture de l'app) — les deux fonctions SQL renvoient VOID : impossible de savoir
 * si elles ont changé quelque chose. On invalidait donc les caches À CHAQUE DÉMARRAGE, dont
 * `pilotage_data` (le fetch le plus lourd), qui repartait aussitôt pour un 2ᵉ aller-retour complet
 * juste après celui du préchargement. Or dans le cas courant il n'y a RIEN à matérialiser. On
 * commence donc par une SONDE en lecture seule (`pending_materialization`, migration 170) : sans
 * travail en attente, ni RPC d'écriture ni invalidation. Si la sonde est absente (migration pas
 * encore appliquée sur cette base), on retombe sur l'ancien comportement — jamais de régression.
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

        // Sonde : que faut-il réellement faire ? En cas d'échec (migration absente, réseau), on ne
        // conclut RIEN — on fait tout, comme avant. Ne jamais déduire « rien à faire » d'une erreur.
        let needsRecurring = true;
        let needsPosted = true;
        const probe = await supabase.rpc('pending_materialization', { p_profile: profileId, p_today: today });
        if (!probe.error) {
          const row = (Array.isArray(probe.data) ? probe.data[0] : probe.data) as
            { needs_recurring?: boolean; needs_posted?: boolean } | null | undefined;
          // Champ manquant → on garde `true` (prudence : on préfère travailler pour rien que sauter).
          needsRecurring = row?.needs_recurring !== false;
          needsPosted = row?.needs_posted !== false;
        }

        if (!needsRecurring && !needsPosted) return; // cas courant : aucune écriture, aucun refetch

        if (needsRecurring) {
          const { error } = await supabase.rpc('materialize_due_recurring', { p_profile: profileId, p_today: today });
          if (error) {
            // Permettre une nouvelle tentative au prochain montage (ex. erreur réseau).
            ranFor.current = null;
            return;
          }
        }
        // Porter au solde les dépenses futures non récurrentes devenues échues (migration 044).
        // La matérialisation vient d'insérer des lignes échues : elles doivent être réconciliées.
        if (needsPosted || needsRecurring) {
          await supabase.rpc('reconcile_posted', { p_profile: profileId, p_today: today });
        }

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
