-- ============================================================================
-- 197 — Ne plus matérialiser d'échéances de crédit sur un compte ARCHIVÉ.
--
-- ── LE PROBLÈME ─────────────────────────────────────────────────────────────
-- `materialize_credit_from_schedule` (143, réécrite en 175) balaie les crédits avec :
--     WHERE cr.is_active AND NOT cr.is_simulation AND cr.account_id IS NOT NULL
-- Rien n'y vérifie que le COMPTE DE PRÉLÈVEMENT est encore actif.
--
-- Or fermer un compte qui porte encore des écritures ne le supprime pas : il est ARCHIVÉ
-- (`is_active = false`, cf. useCloseAccount). À partir de là, l'app et la base ne racontaient plus
-- la même histoire :
--   • côté app, le compte disparaît de `useAllAccounts` (filtré `is_active`), donc le crédit ne
--     produit plus AUCUN flux — ni dans la projection, ni dans le plan de trésorerie, ni au Relyka ;
--   • côté base, cette fonction continuait d'insérer chaque mois de VRAIES transactions
--     d'échéance sur ce compte devenu invisible, et de recalculer son solde.
--
-- Autrement dit : de l'argent écrit là où plus personne ne regarde, indéfiniment. Le jour où le
-- compte est rouvert (useReactivateAccount), des mois d'échéances jamais affichées ressortent d'un
-- coup et faussent le solde de reprise.
--
-- ── LA RÈGLE ────────────────────────────────────────────────────────────────
-- On ne matérialise que vers un compte ACTIF. Le crédit n'est pas perdu pour autant : `materialized_until`
-- n'est PAS avancé pour lui (la boucle ne le sélectionne plus du tout), donc si le compte est
-- rouvert plus tard, les échéances de l'intervalle sont rattrapées normalement — exactement comme
-- pour un cache d'échéancier pas encore publié (le `CONTINUE WHEN` existant suit la même logique).
--
-- Le client applique la même règle en amont (hooks/data/useMaterializeCredits) et `useCloseAccount`
-- refuse désormais de fermer un compte porteur d'un crédit actif. Cette migration reste néanmoins
-- nécessaire : c'est ICI que les écritures ont lieu, et les comptes archivés AVANT cette règle
-- existent déjà en base.
--
-- Seule la clause WHERE de la boucle change ; le corps est identique à la version 175.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_credit_from_schedule(p_today date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c       RECORD;
  v_uid   uuid := auth.uid();
  v_today date;
  v_regul date;
  ins     integer;
  n       integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  -- p_today = date LOCALE du client (cf. 081), mais bornée : un client (malveillant ou à l'horloge
  -- fausse) ne peut pas matérialiser le futur — au plus demain (fuseaux en avance sur UTC).
  v_today := LEAST(p_today, current_date + 1);

  FOR c IN
    SELECT cr.id, cr.profile_id, cr.account_id, cr.materialized_until
    FROM public.credits cr
    JOIN public.accounts acc ON acc.id = cr.account_id   -- 197 : compte de prélèvement…
    WHERE cr.is_active AND NOT cr.is_simulation AND cr.account_id IS NOT NULL
      AND acc.is_active                                   -- …et il doit être ACTIF.
      AND cr.materialized_until < v_today
      AND (
        cr.profile_id = v_uid
        OR public.is_app_admin()
        OR EXISTS (SELECT 1 FROM public.credit_members m
                   WHERE m.credit_id = cr.id AND m.user_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.account_members am
                   WHERE am.account_id = cr.account_id AND am.user_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.accounts a
                   WHERE a.id = cr.account_id AND a.profile_id = v_uid)
      )
  LOOP
    -- Cache pas encore publié par le propriétaire → ne PAS avancer la borne (sinon les échéances
    -- de la fenêtre seraient perdues à jamais) ; on retentera quand le tableau sera publié.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.credit_schedule s WHERE s.credit_id = c.id);

    -- Dernière régularisation du compte (cf. 084) : une échéance datée du JOUR de la régul est
    -- déjà comprise dans le solde réconcilié ; datée avant, la date l'exclut au recalcul.
    SELECT max(date) INTO v_regul
    FROM public.transactions
    WHERE account_id = c.account_id AND COALESCE(is_draft, false) = false
      AND public.is_regul_tx(category_id, note, regul_target);

    INSERT INTO public.transactions
      (profile_id, account_id, category_id, amount, date, note,
       is_forecast, is_reconciled, is_draft, is_recurring,
       credit_id, credit_kind, credit_period, regul_covered)
    SELECT c.profile_id, s.account_id, s.category_id, s.amount, s.date, s.note,
           false, false, false, false,
           s.credit_id, s.kind, s.period,
           (v_regul IS NOT NULL AND s.date <= v_regul)
    FROM public.credit_schedule s
    WHERE s.credit_id = c.id
      AND s.date > c.materialized_until AND s.date <= v_today
    ON CONFLICT (credit_id, credit_kind, credit_period) DO NOTHING;
    GET DIAGNOSTICS ins = ROW_COUNT;
    n := n + ins;

    UPDATE public.credits SET materialized_until = v_today WHERE id = c.id;
    IF ins > 0 THEN
      PERFORM public.recompute_account_balance(c.account_id, v_today);
    END IF;
  END LOOP;

  RETURN n;
END; $$;

GRANT EXECUTE ON FUNCTION public.materialize_credit_from_schedule(date) TO authenticated;
