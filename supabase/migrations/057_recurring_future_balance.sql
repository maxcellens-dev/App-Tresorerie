-- Migration 057 : Les dépenses/recettes RÉCURRENTES futures ne baissent plus le solde du jour.
--
-- Bug : une transaction récurrente datée dans le futur ajoutait immédiatement son montant
-- de base au solde du compte (balanceContribution ignorait la date pour les récurrentes).
-- Résultat : saisir un loyer récurrent qui démarre le mois prochain faisait baisser le
-- solde courant tout de suite. Le solde « à date » ne doit refléter que les occurrences échues.
--
-- Nouveau modèle : le drapeau `posted` indique si le montant de base d'un modèle récurrent
-- est DÉJÀ inclus dans le solde. La matérialisation s'appuie dessus pour ne pas double-compter.

-- 1. Modèles récurrents déjà matérialisés (l'ancienne matérialisation avait retiré la base
--    du solde mais laissé posted=true) → poser posted=false (la base n'est plus dans le solde).
UPDATE transactions t SET posted = false
WHERE COALESCE(t.is_recurring, false) = true
  AND EXISTS (SELECT 1 FROM transactions c WHERE c.materialized_from = t.id);

-- 2. Modèles récurrents FUTURS jamais matérialisés (base indûment portée au solde à la création)
--    → retirer la base du solde, puis poser posted=false.
UPDATE accounts a
SET balance = a.balance - corr.total
FROM (
  SELECT t.account_id, SUM(t.amount) AS total
  FROM transactions t
  WHERE COALESCE(t.is_recurring, false) = true
    AND COALESCE(t.is_draft, false) = false
    AND t.date > current_date
    AND NOT EXISTS (SELECT 1 FROM transactions c WHERE c.materialized_from = t.id)
  GROUP BY t.account_id
) corr
WHERE a.id = corr.account_id
  AND COALESCE(corr.total, 0) <> 0;

UPDATE transactions t SET posted = false
WHERE COALESCE(t.is_recurring, false) = true
  AND COALESCE(t.is_draft, false) = false
  AND t.date > current_date
  AND NOT EXISTS (SELECT 1 FROM transactions c WHERE c.materialized_from = t.id);

-- 3. Matérialisation « posted-aware » : ne retire la base du solde que si elle y était (posted),
--    et marque le modèle avancé comme non-porté (sa prochaine échéance future n'est pas au solde).
CREATE OR REPLACE FUNCTION materialize_due_recurring(p_profile UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t              transactions%ROWTYPE;
  v_today        DATE := current_date;
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
    -- Base déjà incluse dans le solde ? (posté à la création quand la 1re échéance était échue)
    v_base_in_bal := CASE WHEN COALESCE(t.posted, true) THEN t.amount ELSE 0 END;

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

          v_sum_eff := v_sum_eff + v_eff;
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

          v_sum_eff := v_sum_eff + t.amount;
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

    -- Ajustement du solde : ajouter les occurrences passées (Σ effectif), retirer la base
    -- seulement si elle y était déjà (v_base_in_bal).
    UPDATE accounts
    SET balance = balance + (v_sum_eff - v_base_in_bal)
    WHERE id = t.account_id;
  END LOOP;
END;
$$;
