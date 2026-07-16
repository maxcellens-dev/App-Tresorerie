import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { todayISO } from '../lib/dateUtils';
import { useCredits } from './useCredits';
import { useAllCreditEvents } from './useCreditEvents';
import { computeCreditSchedule, creditScheduleHash } from '../lib/creditMaterialization';

/**
 * Matérialisation des échéances de crédit échues en VRAIES transactions (migration 143) — pendant
 * du `useMaterializeRecurring` pour les récurrentes. Deux temps :
 *
 *  1. PROPRIÉTAIRE : publie le tableau d'amortissement complet dans le cache serveur
 *     `credit_schedule` (le serveur ne sait pas calculer l'amortissement : différé, paliers,
 *     événements, overrides → lib/amortization). Republication uniquement si le tableau a changé
 *     (hash stocké sur credits.schedule_hash). Se redéclenche en cours de session après une
 *     édition (signature crédits + événements).
 *
 *  2. TOUS LES PARTICIPANTS : RPC `materialize_credit_from_schedule` (SECURITY DEFINER) — insère
 *     les échéances échues depuis le cache, ATTRIBUÉES AU PROPRIÉTAIRE, borne materialized_until,
 *     dédup par index unique, regul_covered gérés côté SQL, soldes recalculés (recompute 084).
 *     Ainsi le compte est à jour dès qu'UN participant se connecte, même si le propriétaire ne
 *     s'est pas connecté depuis des mois.
 */
export function useMaterializeCredits(profileId: string | undefined) {
  const client = useQueryClient();
  const syncedSig = useRef<string | null>(null);
  const { data: credits = [], isSuccess: creditsReady } = useCredits(profileId);
  const { data: eventsByCredit = {}, isSuccess: eventsReady } = useAllCreditEvents(profileId);

  useEffect(() => {
    if (!supabase || !profileId || !creditsReady || !eventsReady) return;

    // Crédits dont JE publie le tableau. `materialized_until` absent = migration 143 pas encore
    // appliquée → on ne tente rien (ni cache ni RPC), silencieusement.
    const own = credits.filter(
      (c) => c._role === 'owner' && c.is_active && !c.is_simulation && !!c.account_id
        && c.materialized_until != null,
    );
    if (credits.length > 0 && credits.every((c) => c.materialized_until == null)) return;

    // Signature de session : re-passe si un crédit ou ses événements changent (édition en cours
    // de session) — sinon une seule exécution par session et par profil.
    const sig = [
      profileId,
      ...own.map((c) => `${c.id}@${c.updated_at}#${(eventsByCredit[c.id] ?? []).map((e) => e.id).join('.')}`),
    ].join('|');
    if (syncedSig.current === sig) return;
    syncedSig.current = sig;

    (async () => {
      try {
        // ── 1. Publier/rafraîchir le cache serveur du tableau (si changé). ──
        for (const c of own) {
          const occ = computeCreditSchedule(c, eventsByCredit[c.id]);
          const hash = creditScheduleHash(occ);
          if (c.schedule_hash === hash) continue;
          const { error: delErr } = await supabase!.from('credit_schedule').delete().eq('credit_id', c.id);
          if (delErr) throw delErr;
          const rows = occ.map((o) => ({
            credit_id: o.credit_id, kind: o.credit_kind, period: o.credit_period,
            date: o.date, amount: o.amount, account_id: o.account_id,
            category_id: o.category_id, note: o.note,
          }));
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase!.from('credit_schedule').insert(rows.slice(i, i + 500));
            if (error) throw error;
          }
          const { error: hashErr } = await supabase!.from('credits').update({ schedule_hash: hash }).eq('id', c.id);
          if (hashErr) throw hashErr;
        }

        // ── 2. Matérialiser les échéances échues depuis le cache (mes crédits + ceux des autres
        //       participants sur les comptes que je vois). p_today = date LOCALE (cf. 081). ──
        const { data: inserted, error: rpcErr } = await supabase!
          .rpc('materialize_credit_from_schedule', { p_today: todayISO() });
        if (rpcErr) throw rpcErr;

        if ((inserted ?? 0) > 0) {
          client.invalidateQueries({ queryKey: ['transactions', profileId] });
          client.invalidateQueries({ queryKey: ['accounts', profileId] });
          client.invalidateQueries({ queryKey: ['credits', profileId] });
          client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
        }
      } catch {
        // Nouvelle tentative au prochain montage / changement (réseau, migration pas appliquée…).
        syncedSig.current = null;
      }
    })();
  }, [profileId, creditsReady, eventsReady, credits, eventsByCredit, client]);
}
