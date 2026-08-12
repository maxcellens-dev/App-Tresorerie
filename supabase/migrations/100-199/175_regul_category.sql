-- Migration 175 : la RÉGULARISATION peut désormais porter une CATÉGORIE.
--
-- LE PROBLÈME
-- ───────────
-- Une régularisation de solde n'a jamais été catégorisée : elle apparaissait donc en « sans
-- catégorie » dans le reporting et le plan de trésorerie, alors qu'elle correspond bel et bien à de
-- l'argent en moins (dépense) ou en plus (recette). On veut pouvoir l'attribuer à
-- « Frais variables › Régularisation Solde » ou « Autres recettes › Régularisation Solde ».
--
-- Sauf que le moteur de solde RECONNAISSAIT une régularisation à l'ABSENCE de catégorie :
--     WHERE category_id IS NULL AND (note ILIKE '%gul%' OR note = 'Ajustement de solde')
-- Lui coller une catégorie l'aurait rendue invisible comme ANCRE — et on retombait pile sur le bug
-- que la migration 093 avait corrigé (« je saisis 3 130 €, le solde ne tombe pas dessus »).
--
-- LA CORRECTION
-- ─────────────
-- Le marqueur devient `regul_target` (posé sur toute régularisation depuis la 093), avec repli sur
-- le libellé pour les lignes anciennes. C'est EXACTEMENT la règle que le client applique déjà dans
-- lib/regul.ts : une seule définition de « c'est une régularisation », des deux côtés du réseau.
--
-- La règle vit dans UNE fonction, `is_regul_tx`, appelée par les trois fonctions concernées. Leurs
-- corps sont recopiés à l'identique depuis les migrations 173 / 163 / 143 : seul le prédicat change.

CREATE OR REPLACE FUNCTION public.is_regul_tx(
  p_category_id uuid,
  p_note        text,
  p_regul_target numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- Marqueur de référence : `regul_target` (indépendant de la catégorie ET du libellé saisi).
  -- Repli historique : les régularisations d'avant la colonne, reconnaissables au libellé et à
  -- l'absence de catégorie — l'ancienne règle, conservée telle quelle pour ces lignes-là.
  SELECT p_regul_target IS NOT NULL
      OR (p_category_id IS NULL AND (p_note ILIKE '%gul%' OR p_note = 'Ajustement de solde'));
$fn$;

-- ── recompute_account_balance (corps de la migration 173, prédicat mis à jour) ──────────────
CREATE OR REPLACE FUNCTION recompute_account_balance(p_account UUID, p_today DATE DEFAULT current_date)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_regul_id      UUID;
  v_regul_date    DATE;
  v_regul_created TIMESTAMPTZ;
  v_regul_target  NUMERIC(14,2);
  v_bal           NUMERIC(14,2);
BEGIN
  -- Dernière régularisation de solde sur ce compte (date + instant de saisie + cible).
  SELECT id, date, created_at, regul_target
    INTO v_regul_id, v_regul_date, v_regul_created, v_regul_target
  FROM transactions
  WHERE account_id = p_account
    AND COALESCE(is_draft, false) = false
    AND public.is_regul_tx(category_id, note, regul_target)
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  IF v_regul_id IS NOT NULL AND v_regul_target IS NOT NULL THEN
    -- ── Modèle ANCRE : cible + transactions strictement postérieures à la régul ──
    SELECT v_regul_target + COALESCE(SUM(tx.amount), 0) INTO v_bal
    FROM transactions tx
    WHERE tx.account_id = p_account
      AND COALESCE(tx.is_draft, false) = false
      AND tx.date <= p_today
      AND tx.id <> v_regul_id
      AND (
        tx.date > v_regul_date
        OR (
          tx.date = v_regul_date
          AND tx.created_at > v_regul_created
          AND NOT COALESCE(tx.regul_covered, false)
        )
      );
  ELSE
    -- ── Repli historique : somme de tout avec exclusions (cf. migration 084) ──
    SELECT COALESCE(SUM(amount), 0) INTO v_bal
    FROM transactions tx
    WHERE tx.account_id = p_account
      AND COALESCE(tx.is_draft, false) = false
      AND tx.date <= p_today
      AND NOT (
        v_regul_date IS NOT NULL
        AND NOT public.is_regul_tx(tx.category_id, tx.note, tx.regul_target)
        AND (
          (tx.date < v_regul_date AND tx.created_at > v_regul_created)
          OR (tx.date = v_regul_date AND COALESCE(tx.regul_covered, false))
        )
      );
  END IF;

  UPDATE accounts SET balance = v_bal WHERE id = p_account;
  RETURN v_bal;
END;
$$;

-- Le DROP de la 173 avait emporté ces deux réglages : ils suivent toute redéfinition.
ALTER FUNCTION public.recompute_account_balance(uuid, date) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.recompute_account_balance(uuid, date) TO authenticated;

-- ── materialize_due_recurring (corps de la migration 163, prédicat mis à jour) ──────────────
CREATE OR REPLACE FUNCTION materialize_due_recurring(p_profile UUID, p_today DATE DEFAULT current_date)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t              transactions%ROWTYPE;
  v_today        DATE := p_today;
  v_end          DATE;
  v_base_day     INT;
  v_step_months  INT;
  v_total_months INT;
  v_year         INT;
  v_month        INT;
  v_dim          INT;
  v_day          INT;
  v_occ          DATE;
  v_ovr          public.transaction_month_overrides%ROWTYPE;
  v_eff          NUMERIC(14,2);
  v_eff_note     TEXT;
  v_eff_cat      UUID;
  v_eff_acc      UUID;
  v_next_start   DATE;
  v_regul        DATE;
  i              INT;
BEGIN
  FOR t IN
    SELECT *
    FROM transactions
    WHERE profile_id = p_profile
      AND COALESCE(is_recurring, false) = true
      AND recurrence_rule IS NOT NULL
      AND COALESCE(is_draft, false) = false
      AND date <= v_today
  LOOP
    v_end        := t.recurrence_end_date;
    v_base_day   := EXTRACT(DAY FROM t.date)::INT;
    v_next_start := NULL;

    SELECT max(date) INTO v_regul
    FROM transactions
    WHERE account_id = t.account_id
      AND COALESCE(is_draft, false) = false
      AND public.is_regul_tx(category_id, note, regul_target);

    IF t.recurrence_rule IN ('monthly', 'quarterly', 'yearly') THEN
      v_step_months := CASE t.recurrence_rule
                         WHEN 'monthly'   THEN 1
                         WHEN 'quarterly' THEN 3
                         ELSE 12
                       END;
      i := 0;
      LOOP
        v_total_months := (EXTRACT(YEAR FROM t.date)::INT * 12
                            + EXTRACT(MONTH FROM t.date)::INT - 1)
                           + i * v_step_months;
        v_year  := v_total_months / 12;
        v_month := v_total_months % 12 + 1;
        v_dim   := EXTRACT(DAY FROM (make_date(v_year, v_month, 1) + INTERVAL '1 month - 1 day'))::INT;
        v_day   := LEAST(v_base_day, v_dim);
        v_occ   := make_date(v_year, v_month, v_day);

        EXIT WHEN v_end IS NOT NULL AND v_occ > v_end;

        IF v_occ <= v_today THEN
          SELECT * INTO v_ovr
          FROM transaction_month_overrides
          WHERE transaction_id = t.id AND profile_id = p_profile
            AND year = v_year AND month = v_month;
          v_eff      := COALESCE(v_ovr.override_amount, t.amount);
          v_eff_note := COALESCE(v_ovr.override_note, t.note);
          v_eff_cat  := COALESCE(v_ovr.override_category_id, t.category_id);
          v_eff_acc  := COALESCE(v_ovr.override_account_id, t.account_id);
          v_ovr := NULL;

          IF NOT EXISTS (
            SELECT 1 FROM transactions
            WHERE materialized_from = t.id AND date = v_occ
          ) THEN
            INSERT INTO transactions
              (profile_id, account_id, category_id, project_id, linked_account_id,
               amount, date, note, is_forecast, is_reconciled, is_draft,
               is_recurring, recurrence_rule, recurrence_end_date, materialized_from, regul_covered)
            VALUES
              (p_profile, v_eff_acc, v_eff_cat, t.project_id, t.linked_account_id,
               v_eff, v_occ, v_eff_note, false, false, false,
               false, NULL, NULL, t.id,
               (v_regul IS NOT NULL AND v_occ <= v_regul));
          END IF;
        ELSE
          v_next_start := v_occ;
          EXIT;
        END IF;

        i := i + 1;
        EXIT WHEN i > 1200;
      END LOOP;

    ELSIF t.recurrence_rule = 'weekly' THEN
      v_occ := t.date;
      i := 0;
      LOOP
        EXIT WHEN v_end IS NOT NULL AND v_occ > v_end;

        IF v_occ <= v_today THEN
          IF NOT EXISTS (
            SELECT 1 FROM transactions
            WHERE materialized_from = t.id AND date = v_occ
          ) THEN
            INSERT INTO transactions
              (profile_id, account_id, category_id, project_id, linked_account_id,
               amount, date, note, is_forecast, is_reconciled, is_draft,
               is_recurring, recurrence_rule, recurrence_end_date, materialized_from, regul_covered)
            VALUES
              (p_profile, t.account_id, t.category_id, t.project_id, t.linked_account_id,
               t.amount, v_occ, t.note, false, false, false,
               false, NULL, NULL, t.id,
               (v_regul IS NOT NULL AND v_occ <= v_regul));
          END IF;
        ELSE
          v_next_start := v_occ;
          EXIT;
        END IF;

        v_occ := v_occ + INTERVAL '7 days';
        i := i + 1;
        EXIT WHEN i > 5200;
      END LOOP;
    END IF;

    -- Nettoyage des overrides RÉELLEMENT figés dans des lignes matérialisées — et eux seuls
    -- (borne = prochaine occurrence EN ATTENTE, jamais « le mois courant » : cf. migration 160).
    IF v_next_start IS NOT NULL THEN
      DELETE FROM transaction_month_overrides
      WHERE transaction_id = t.id AND profile_id = p_profile
        AND make_date(year, month, 1) < date_trunc('month', v_next_start)::DATE;
    ELSE
      DELETE FROM transaction_month_overrides
      WHERE transaction_id = t.id AND profile_id = p_profile;
    END IF;

    IF v_next_start IS NOT NULL THEN
      UPDATE transactions SET date = v_next_start, posted = false WHERE id = t.id;
    ELSE
      DELETE FROM transactions WHERE id = t.id;
    END IF;

    -- Solde : le compte du modèle, PLUS tout compte où une occurrence a été matérialisée. Un
    -- `override_account_id` peut avoir posé l'échéance sur un AUTRE compte : ne recalculer que
    -- celui du modèle l'aurait laissé faux.
    PERFORM recompute_account_balance(t.account_id, v_today);
    PERFORM recompute_account_balance(a_id, v_today)
    FROM (
      SELECT DISTINCT account_id AS a_id FROM transactions
      WHERE materialized_from = t.id AND account_id <> t.account_id
    ) s;
  END LOOP;
END;
$$;

-- ── materialize_credit_from_schedule (corps de la migration 143, prédicat mis à jour) ───────
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
    WHERE cr.is_active AND NOT cr.is_simulation AND cr.account_id IS NOT NULL
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

-- ── La sous-catégorie côté DÉPENSE : on la DÉPLACE, on n'en crée pas une deuxième ─────────────
-- « Régularisation solde » existait déjà, mais sous « Mouvements » — le tiroir des écritures
-- NEUTRES (virements vers l'épargne, l'investissement), marqué is_variable = false. Une correction
-- de solde à la baisse, elle, est bien de l'argent qui a quitté le compte : sa place est dans
-- « Frais variables », au même titre que les courses. Créer une seconde catégorie du même nom
-- aurait laissé les écritures déjà saisies dans l'ancienne, et deux lignes identiques au sélecteur.
UPDATE public.base_categories c
SET parent_id = fv.id, is_variable = true, sort_order = 99
FROM public.base_categories mv, public.base_categories fv
WHERE c.parent_id = mv.id
  AND mv.parent_id IS NULL AND mv.type = 'expense' AND mv.name = 'Mouvements'
  AND fv.parent_id IS NULL AND fv.type = 'expense' AND fv.name = 'Frais variables'
  AND c.name ILIKE 'r%gularisation solde';

-- Filet : si le référentiel de base ne l'avait pas (installation partielle), on la crée.
INSERT INTO public.base_categories (name, type, parent_id, sort_order, is_variable, is_active)
SELECT 'Régularisation Solde', 'expense', fv.id, 99, true, true
FROM public.base_categories fv
WHERE fv.parent_id IS NULL AND fv.type = 'expense' AND fv.name = 'Frais variables'
  AND NOT EXISTS (
    SELECT 1 FROM public.base_categories c
    WHERE c.parent_id = fv.id AND c.name ILIKE 'r%gularisation solde'
  );

-- Les copies par-utilisateur suivent le MÊME déplacement. `apply_base_categories` réaligne
-- sort_order et is_variable, mais jamais le parent : il faut donc le poser explicitement, en
-- s'appuyant sur `base_id` (le lien vers le référentiel) plutôt que sur le nom — un utilisateur
-- a pu renommer sa catégorie, elle doit quand même déménager.
UPDATE public.categories uc
SET parent_id = upfv.id
FROM public.base_categories bc, public.base_categories fv, public.categories upfv
WHERE uc.base_id = bc.id
  AND bc.name ILIKE 'r%gularisation solde' AND bc.type = 'expense'
  AND fv.id = bc.parent_id AND fv.name = 'Frais variables'
  AND upfv.profile_id = uc.profile_id AND upfv.base_id = fv.id;

-- Propagation de ce qui manque encore (même RPC que « Appliquer à tous » en admin : il n'ajoute
-- que l'absent, réaligne le placement, et ne touche à aucun renommage utilisateur).
SELECT public.apply_base_categories();

NOTIFY pgrst, 'reload schema';
