-- Migration 083 : matérialisation des récurrentes consciente des régularisations de solde.
--
-- Problème : materialize_due_recurring (081) porte au solde TOUTES les occurrences passées,
-- sans regarder s'il existe une régularisation de solde sur le compte. Or une régul « fait foi »
-- le jour qu'elle indique : tout ce qui est daté ≤ cette régul est déjà reflété dans le solde
-- régularisé. Une récurrente créée avec une date de départ dans le passé matérialise alors des
-- occurrences antérieures (ou égales) à la régul → elles rediminuent le solde → DOUBLE COMPTAGE.
--
-- Règle appliquée (alignée sur la saisie manuelle, cf. effectiveBalanceDelta + prompt §P12bis) :
--   • occurrence datée AVANT la dernière régul → n'impacte pas le solde (déjà captée) ;
--   • occurrence datée APRÈS la dernière régul → impacte le solde (nouvelle activité) ;
--   • occurrence le JOUR de la régul → « déjà incluse » (la régul fait foi ce jour-là) → n'impacte pas.
-- Les lignes sont TOUJOURS matérialisées (l'historique reste complet) ; seul l'impact SOLDE change,
-- exactement comme une transaction manuelle antérieure à une régul (absorbée mais visible).
--
-- NB : ne corrige que les futures matérialisations. Les occurrences déjà matérialisées avant cette
-- migration gardent leur impact (idempotence via materialized_from) ; un solde déjà faussé doit être
-- recalé par une régularisation.

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
  v_override     NUMERIC(14,2);
  v_eff          NUMERIC(14,2);
  v_sum_eff      NUMERIC(14,2);
  v_next_start   DATE;
  v_base_in_bal  NUMERIC(14,2);
  v_regul_date   DATE;
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
    v_sum_eff    := 0;
    v_next_start := NULL;

    -- Dernière régularisation de solde sur CE compte. Une occurrence datée ≤ cette date est
    -- déjà reflétée dans le solde régularisé (régul fait foi ce jour-là) → pas d'impact solde.
    -- (Mêmes critères que effectiveBalanceDelta / regulOnSameDay côté app : catégorie nulle +
    --  libellé « …gul… » ou « Ajustement de solde ».)
    SELECT max(date) INTO v_regul_date
    FROM transactions
    WHERE account_id = t.account_id
      AND COALESCE(is_draft, false) = false
      AND category_id IS NULL
      AND (note ILIKE '%gul%' OR note = 'Ajustement de solde');

    -- Base déjà incluse dans le solde ? Portée à la création (posted) ET non absorbée par une régul.
    -- (Si la 1re échéance est ≤ régul, sa base a été absorbée à la création OU est déjà dans le
    --  solde régularisé → dans les deux cas il ne faut pas la retirer.)
    v_base_in_bal := CASE
                       WHEN COALESCE(t.posted, true)
                            AND (v_regul_date IS NULL OR t.date > v_regul_date)
                       THEN t.amount ELSE 0
                     END;

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
          SELECT override_amount INTO v_override
          FROM transaction_month_overrides
          WHERE transaction_id = t.id AND profile_id = p_profile
            AND year = v_year AND month = v_month;
          v_eff := COALESCE(v_override, t.amount);
          v_override := NULL;

          IF NOT EXISTS (
            SELECT 1 FROM transactions
            WHERE materialized_from = t.id AND date = v_occ
          ) THEN
            INSERT INTO transactions
              (profile_id, account_id, category_id, project_id, linked_account_id,
               amount, date, note, is_forecast, is_reconciled, is_draft,
               is_recurring, recurrence_rule, recurrence_end_date, materialized_from)
            VALUES
              (p_profile, t.account_id, t.category_id, t.project_id, t.linked_account_id,
               v_eff, v_occ, t.note, false, false, false,
               false, NULL, NULL, t.id);
          END IF;

          -- N'impacte le solde que si l'occurrence est POSTÉRIEURE à la dernière régul.
          IF v_regul_date IS NULL OR v_occ > v_regul_date THEN
            v_sum_eff := v_sum_eff + v_eff;
          END IF;
        ELSE
          v_next_start := v_occ;
          EXIT;
        END IF;

        i := i + 1;
        EXIT WHEN i > 1200; -- garde-fou (100 ans en mensuel)
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
               is_recurring, recurrence_rule, recurrence_end_date, materialized_from)
            VALUES
              (p_profile, t.account_id, t.category_id, t.project_id, t.linked_account_id,
               t.amount, v_occ, t.note, false, false, false,
               false, NULL, NULL, t.id);
          END IF;

          IF v_regul_date IS NULL OR v_occ > v_regul_date THEN
            v_sum_eff := v_sum_eff + t.amount;
          END IF;
        ELSE
          v_next_start := v_occ;
          EXIT;
        END IF;

        v_occ := v_occ + INTERVAL '7 days';
        i := i + 1;
        EXIT WHEN i > 5200; -- garde-fou (~100 ans en hebdo)
      END LOOP;
    END IF;

    -- Nettoyage des overrides passés (désormais figés dans les lignes réelles).
    DELETE FROM transaction_month_overrides
    WHERE transaction_id = t.id AND profile_id = p_profile
      AND make_date(year, month, 1) <= date_trunc('month', v_today)::DATE;

    -- Disposition du modèle : avancer au futur (base future NON portée → posted=false), ou supprimer.
    IF v_next_start IS NOT NULL THEN
      UPDATE transactions SET date = v_next_start, posted = false WHERE id = t.id;
    ELSE
      DELETE FROM transactions WHERE id = t.id;
    END IF;

    -- Ajustement du solde : ajouter les occurrences passées POSTÉRIEURES à la régul (Σ effectif),
    -- retirer la base seulement si elle y était déjà (et non absorbée par une régul).
    UPDATE accounts
    SET balance = balance + (v_sum_eff - v_base_in_bal)
    WHERE id = t.account_id;
  END LOOP;
END;
$$;
