-- ============================================================================
-- 170 — Savoir, AVANT de la lancer, si la matérialisation a quelque chose à faire.
--
-- PERF (ouverture de l'app). À chaque démarrage, `useMaterializeRecurring` appelait
-- `materialize_due_recurring` puis `reconcile_posted`, puis invalidait `transactions`, `accounts`,
-- `transaction_month_overrides` et `pilotage_data`. Or ces deux fonctions renvoient VOID : le
-- client ne pouvait pas savoir si elles avaient changé quoi que ce soit, donc il invalidait
-- TOUJOURS. Résultat : `pilotage_data` — le fetch le plus lourd de l'app (transactions sur 8 mois
-- + jointures + comptes partagés + crédits) — était rechargé une SECONDE fois à chaque ouverture,
-- en concurrence avec le préchargement qui venait de le charger. Alors que dans le cas courant
-- (aucune échéance échue depuis la dernière ouverture), les deux fonctions ne font littéralement
-- rien : leur boucle ne sélectionne aucune ligne.
--
-- On expose donc une SONDE, volontairement minimale : elle teste EXACTEMENT les conditions
-- d'entrée des deux fonctions, sans rien écrire. Le client ne lance chacune que si elle a du
-- travail, et n'invalide que dans ce cas.
--
--   • needs_recurring : il existe un MODÈLE récurrent dont la prochaine occurrence est échue
--     (mêmes prédicats que la boucle FOR de materialize_due_recurring, cf. migration 163).
--   • needs_posted    : il existe une transaction échue pas encore portée au solde
--     (mêmes prédicats que reconcile_posted, cf. migration 081).
--
-- STABLE + SECURITY INVOKER : lecture pure, soumise à la RLS comme tout le reste (un utilisateur
-- ne sonde que ses propres lignes ; un admin en consultation voit celles du compte visité, via les
-- mêmes policies que les écrans).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pending_materialization(
  p_profile UUID,
  p_today   DATE DEFAULT current_date
)
RETURNS TABLE (needs_recurring BOOLEAN, needs_posted BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.transactions
      WHERE profile_id = p_profile
        AND COALESCE(is_recurring, false) = true
        AND recurrence_rule IS NOT NULL
        AND COALESCE(is_draft, false) = false
        AND date <= p_today
    ),
    EXISTS (
      SELECT 1 FROM public.transactions
      WHERE profile_id = p_profile
        AND COALESCE(is_draft, false) = false
        AND COALESCE(is_recurring, false) = false
        AND COALESCE(posted, true) = false
        AND date <= p_today
    );
$$;

COMMENT ON FUNCTION public.pending_materialization(UUID, DATE) IS
  'Sonde en lecture seule : y a-t-il des occurrences récurrentes échues à matérialiser, et/ou des transactions échues à porter au solde ? Évite d''appeler (et surtout d''invalider les caches après) materialize_due_recurring / reconcile_posted pour rien à chaque ouverture.';

NOTIFY pgrst, 'reload schema';
