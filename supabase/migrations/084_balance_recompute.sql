-- Migration 084 : solde fiabilisé par RECALCUL (source de vérité unique).
--
-- Problème de fond : accounts.balance était maintenu de façon INCRÉMENTALE, et la décision
-- « cette transaction compte-t-elle dans le solde ? » était RE-DÉRIVÉE à chaque opération à partir
-- de la date (strictement avant la dernière régul). Le prompt « déjà incluse » (même jour qu'une
-- régul) est une décision NON déterministe par la date et non stockée → l'édition/suppression la
-- re-déduisaient à l'envers → le solde dérivait (cf. bugs signalés).
--
-- Correctif : une fonction recompute_account_balance() recalcule le solde depuis des FAITS stables :
--   solde = Σ montants des transactions non-brouillon, échues (date ≤ aujourd'hui), NON couvertes
--           par une régularisation. « Couverte » = (pas une ligne de régul) ET il existe une régul
--           sur le compte ET (datée AVANT la régul  OU  le JOUR de la régul ET regul_covered=true).
-- Le client appelle ce recalcul après chaque mutation → aucune dérive possible. regul_covered n'est
-- nécessaire QUE pour le cas ambigu « même jour » (le reste est dérivé de la date au recalcul).

-- 1. Colonnes
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS regul_covered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS regul_target NUMERIC(14,2);

-- 2. Recalcul du solde d'UN compte (fonction centrale).
--    La régul est une ligne de DELTA (amount = cible − solde du moment) ; elle est sommée comme
--    les autres. Une transaction « ne compte pas » UNIQUEMENT si :
--      • elle est datée AVANT la dernière régul ET a été SAISIE APRÈS elle (created_at) → elle n'a
--        pas participé à la réconciliation (sinon le delta de régul la compense déjà), OU
--      • elle est datée LE JOUR de la régul ET marquée « déjà incluse » (regul_covered).
--    Les transactions datées avant la régul mais saisies AVANT elle restent comptées : le delta de
--    la régul, calculé contre le solde qui les incluait, les compense exactement.
CREATE OR REPLACE FUNCTION recompute_account_balance(p_account UUID, p_today DATE DEFAULT current_date)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_regul_date    DATE;
  v_regul_created TIMESTAMPTZ;
  v_bal           NUMERIC(14,2);
BEGIN
  -- Dernière régularisation de solde sur ce compte (date + instant de saisie).
  SELECT date, created_at INTO v_regul_date, v_regul_created
  FROM transactions
  WHERE account_id = p_account
    AND COALESCE(is_draft, false) = false
    AND category_id IS NULL
    AND (note ILIKE '%gul%' OR note = 'Ajustement de solde')
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  SELECT COALESCE(SUM(amount), 0) INTO v_bal
  FROM transactions tx
  WHERE tx.account_id = p_account
    AND COALESCE(tx.is_draft, false) = false
    AND tx.date <= p_today
    AND NOT (
      v_regul_date IS NOT NULL
      AND NOT (tx.category_id IS NULL AND (tx.note ILIKE '%gul%' OR tx.note = 'Ajustement de solde'))
      AND (
        (tx.date < v_regul_date AND tx.created_at > v_regul_created)
        OR (tx.date = v_regul_date AND COALESCE(tx.regul_covered, false))
      )
    );

  UPDATE accounts SET balance = v_bal WHERE id = p_account;
END;
$$;

-- 3. reconcile_posted : devient un simple recalcul de TOUS les comptes du profil (gère aussi les
--    transactions futures devenues échues d'un jour à l'autre, sans logique incrémentale).
DROP FUNCTION IF EXISTS reconcile_posted(UUID, DATE);
CREATE OR REPLACE FUNCTION reconcile_posted(p_profile UUID, p_today DATE DEFAULT current_date)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  a RECORD;
BEGIN
  FOR a IN SELECT id FROM accounts WHERE profile_id = p_profile LOOP
    PERFORM recompute_account_balance(a.id, p_today);
  END LOOP;
END;
$$;

-- 4. materialize_due_recurring : matérialise les occurrences échues (lignes d'historique), pose
--    regul_covered sur celles ≤ régul (occurrence le jour de la régul = « déjà incluse » par défaut),
--    avance/supprime le modèle, puis RECALCULE le solde (plus de calcul de delta fragile).
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

    -- Dernière régul sur le compte de la récurrente (pour marquer les occurrences couvertes).
    SELECT max(date) INTO v_regul
    FROM transactions
    WHERE account_id = t.account_id
      AND COALESCE(is_draft, false) = false
      AND category_id IS NULL
      AND (note ILIKE '%gul%' OR note = 'Ajustement de solde');

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
               is_recurring, recurrence_rule, recurrence_end_date, materialized_from, regul_covered)
            VALUES
              (p_profile, t.account_id, t.category_id, t.project_id, t.linked_account_id,
               v_eff, v_occ, t.note, false, false, false,
               false, NULL, NULL, t.id,
               (v_regul IS NOT NULL AND v_occ <= v_regul));
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
        EXIT WHEN i > 5200; -- garde-fou (~100 ans en hebdo)
      END LOOP;
    END IF;

    -- Nettoyage des overrides passés (désormais figés dans les lignes réelles).
    DELETE FROM transaction_month_overrides
    WHERE transaction_id = t.id AND profile_id = p_profile
      AND make_date(year, month, 1) <= date_trunc('month', v_today)::DATE;

    -- Disposition du modèle : avancer au futur, ou supprimer si la récurrence est finie.
    IF v_next_start IS NOT NULL THEN
      UPDATE transactions SET date = v_next_start, posted = false WHERE id = t.id;
    ELSE
      DELETE FROM transactions WHERE id = t.id;
    END IF;

    -- Recalcul du solde du compte impacté (source de vérité, pas de delta).
    PERFORM recompute_account_balance(t.account_id, v_today);
  END LOOP;
END;
$$;

-- 5. Bascule des comptes existants vers le modèle « solde dérivé ».
--    Le solde initial des comptes existants n'est PAS une transaction (il était écrit dans le champ
--    accounts.balance). Or le recalcul = Σ(transactions) le remettrait à zéro. On adosse donc à
--    chaque compte une transaction « Solde initial » = (solde actuel − Σ recompute) pour PRÉSERVER
--    exactement le solde courant, puis on recalcule. created_at très ancien → ce solde initial n'est
--    jamais « exclu » par une régul (il fait partie de la base réconciliée).
DO $$
DECLARE
  a               RECORD;
  v_regul_date    DATE;
  v_regul_created TIMESTAMPTZ;
  v_sum           NUMERIC(14,2);
  v_opening       NUMERIC(14,2);
BEGIN
  FOR a IN SELECT id, profile_id, balance, init_date FROM accounts LOOP
    SELECT date, created_at INTO v_regul_date, v_regul_created
    FROM transactions
    WHERE account_id = a.id AND COALESCE(is_draft, false) = false
      AND category_id IS NULL AND (note ILIKE '%gul%' OR note = 'Ajustement de solde')
    ORDER BY date DESC, created_at DESC LIMIT 1;

    SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM transactions tx
    WHERE tx.account_id = a.id AND COALESCE(tx.is_draft, false) = false AND tx.date <= current_date
      AND NOT (
        v_regul_date IS NOT NULL
        AND NOT (tx.category_id IS NULL AND (tx.note ILIKE '%gul%' OR tx.note = 'Ajustement de solde'))
        AND ((tx.date < v_regul_date AND tx.created_at > v_regul_created)
             OR (tx.date = v_regul_date AND COALESCE(tx.regul_covered, false)))
      );

    v_opening := COALESCE(a.balance, 0) - v_sum;
    IF v_opening <> 0 THEN
      INSERT INTO transactions (profile_id, account_id, category_id, amount, date, note,
                                is_draft, is_recurring, posted, created_at)
      VALUES (a.profile_id, a.id, NULL, v_opening,
              COALESCE(a.init_date,
                       (SELECT min(date) FROM transactions
                        WHERE account_id = a.id AND COALESCE(is_draft, false) = false),
                       current_date),
              'Solde initial',
              -- created_at très ancien → jamais exclu par une régul (fait partie de la base).
              false, false, true, TIMESTAMPTZ '1970-01-01 00:00:00+00');
    END IF;

    PERFORM recompute_account_balance(a.id, current_date);
  END LOOP;
END;
$$;
