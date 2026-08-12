-- Migration 030 : Matérialisation des occurrences récurrentes échues
--
-- Problème : une transaction récurrente n'est qu'un "modèle" (une seule ligne en base)
-- projetée mois par mois côté affichage. Son montant n'est ajouté au solde du compte
-- qu'UNE fois (à la création). Quand le temps passe, les occurrences échues
-- (≤ aujourd'hui) ne sont jamais matérialisées : elles n'apparaissent pas dans
-- l'historique du compte et le solde ne les reflète pas.
--
-- Solution : pour chaque modèle récurrent dont la date de départ est ≤ aujourd'hui,
-- on crée de vraies lignes (is_recurring = false) pour chaque occurrence échue,
-- on ajuste le solde du compte, puis on AVANCE la date de départ du modèle à la
-- première occurrence future (ou on supprime le modèle si la récurrence est terminée).
-- Ainsi l'affichage (qui projette le modèle depuis sa date de départ) ne projette plus
-- que le futur, et les lignes réelles couvrent le passé : aucun double comptage.
--
-- Idempotent : après exécution, le modèle démarre dans le futur → il n'est plus
-- sélectionné tant qu'aucune nouvelle occurrence n'est échue. La colonne
-- materialized_from garantit en plus l'absence de doublon.

-- 1. Provenance des lignes matérialisées (vers le modèle d'origine)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS materialized_from UUID REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_materialized_from
  ON transactions(materialized_from) WHERE materialized_from IS NOT NULL;

-- 2. Fonction de matérialisation (SECURITY INVOKER → soumise au RLS de l'appelant)
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
      -- NB : les overrides mensuels ne s'appliquent pas au pas hebdomadaire
      -- (combinaison très rare). Chaque occurrence est matérialisée au montant de base.
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

    -- Disposition du modèle : avancer au futur, ou supprimer si la récurrence est finie.
    IF v_next_start IS NOT NULL THEN
      UPDATE transactions SET date = v_next_start WHERE id = t.id;
    ELSE
      DELETE FROM transactions WHERE id = t.id;
    END IF;

    -- Ajustement du solde : le solde ne contenait que le montant de base (t.amount),
    -- ajouté une fois à la création. Les occurrences passées doivent y contribuer
    -- pour leur montant effectif → delta = Σ(effectif passé) − base.
    UPDATE accounts
    SET balance = balance + (v_sum_eff - t.amount)
    WHERE id = t.account_id;
  END LOOP;
END;
$$;
