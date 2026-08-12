-- Migration 160 : ne plus effacer l'override d'une échéance ENCORE À VENIR.
--
-- Bug : à la fin de `materialize_due_recurring`, le nettoyage des overdrives « passés » effaçait
-- TOUS les overrides du mois courant et des mois antérieurs :
--
--     DELETE FROM transaction_month_overrides
--     WHERE ... AND make_date(year, month, 1) <= date_trunc('month', v_today)::DATE;
--
-- L'intention était juste : une fois l'occurrence matérialisée, son montant est FIGÉ dans la ligne
-- réelle, l'override ne sert plus. Mais la borne est le MOIS COURANT, pas l'occurrence réellement
-- matérialisée. Si le modèle est en retard de plusieurs mois (app pas ouverte depuis mai, on est
-- le 20 juillet, échéance le 28), la boucle matérialise mai et juin, s'arrête sur le 28 juillet
-- (> aujourd'hui) — et le DELETE emporte quand même l'override de JUILLET, qui n'a jamais été
-- appliqué. La modification « cette échéance uniquement » saisie par l'utilisateur disparaissait
-- au lancement suivant, sans rien dire, et l'échéance reprenait le montant de la série.
--
-- Correctif : on ne supprime que les overrides des mois STRICTEMENT ANTÉRIEURS à la prochaine
-- occurrence en attente (donc uniquement ceux qui sont bien figés dans des lignes réelles). Si la
-- série est terminée (pas de prochaine occurrence → le modèle est supprimé juste après), on purge
-- tout : plus rien ne peut s'y rattacher.
--
-- Aucun changement dans le cas courant : pour une mensuelle à jour, la prochaine occurrence est le
-- mois suivant → la borne est exactement la même qu'avant.

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

    -- Nettoyage des overrides RÉELLEMENT figés dans des lignes matérialisées — et eux seuls.
    -- ⚠️ La borne est la prochaine occurrence EN ATTENTE, jamais « le mois courant » : sinon une
    -- échéance de ce mois encore à venir perdait sa modification (cf. en-tête).
    IF v_next_start IS NOT NULL THEN
      DELETE FROM transaction_month_overrides
      WHERE transaction_id = t.id AND profile_id = p_profile
        AND make_date(year, month, 1) < date_trunc('month', v_next_start)::DATE;
    ELSE
      -- Série terminée : le modèle est supprimé juste en dessous → plus aucune occurrence à venir.
      DELETE FROM transaction_month_overrides
      WHERE transaction_id = t.id AND profile_id = p_profile;
    END IF;

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
