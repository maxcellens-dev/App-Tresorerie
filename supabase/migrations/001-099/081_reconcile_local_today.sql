-- Migration 081 : unifier le référentiel « aujourd'hui » entre le client et la base.
--
-- Bug systémique : le client décide ce qui est « échu » avec la date LOCALE de l'appareil
-- (balanceContribution → localTodayISO), mais reconcile_posted() et materialize_due_recurring()
-- utilisaient current_date = date UTC du serveur. Entre minuit local et minuit UTC, les deux ne
-- sont pas d'accord sur le jour courant → une transaction/échéance peut être comptée par l'un et
-- pas par l'autre (solde qui « saute » près de minuit, surtout sur les récurrents et virements).
--
-- Correctif : les deux fonctions acceptent désormais p_today (la date locale du client). Le client
-- la passe systématiquement (todayISO). Valeur par défaut = current_date pour tout appelant tiers.

-- Anciennes signatures (1 argument) supprimées pour éviter l'ambiguïté avec la valeur par défaut.
DROP FUNCTION IF EXISTS reconcile_posted(UUID);
DROP FUNCTION IF EXISTS materialize_due_recurring(UUID);

-- ── reconcile_posted : porte au solde les transactions échues (≤ p_today) pas encore portées ──
CREATE OR REPLACE FUNCTION reconcile_posted(p_profile UUID, p_today DATE DEFAULT current_date)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT account_id, SUM(amount) AS total
    FROM transactions
    WHERE profile_id = p_profile
      AND COALESCE(is_draft, false) = false
      AND COALESCE(is_recurring, false) = false
      AND COALESCE(posted, true) = false
      AND date <= p_today
    GROUP BY account_id
  LOOP
    UPDATE accounts SET balance = balance + r.total WHERE id = r.account_id;
  END LOOP;

  UPDATE transactions
  SET posted = true
  WHERE profile_id = p_profile
    AND COALESCE(is_draft, false) = false
    AND COALESCE(is_recurring, false) = false
    AND COALESCE(posted, true) = false
    AND date <= p_today;
END;
$$;

-- ── materialize_due_recurring : matérialise les occurrences échues (≤ p_today), posted-aware ──
-- (Reprend la logique de la migration 057 à l'identique, current_date → p_today.)
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
