-- ============================================================================
-- 163 — Échéance modifiée : au-delà du montant, on peut aussi changer le libellé, la catégorie
--       et le compte d'UNE SEULE occurrence d'une récurrente.
--
-- Jusqu'ici `transaction_month_overrides` ne portait que `override_amount` et `override_date` :
-- modifier le libellé ou la catégorie d'une échéance s'appliquait donc FORCÉMENT à toute la série
-- (cf. l'éditeur de transaction, qui le disait en commentaire faute de pouvoir faire autrement).
-- L'utilisateur n'avait aucun moyen de dire « ce mois-ci seulement, c'est autre chose ».
--
-- On étend donc la table existante plutôt que de détacher l'occurrence : l'échéance reste rattachée
-- à sa série (donc réversible, et la série continue de se projeter normalement), exactement comme
-- pour le montant et la date. NULL = « pas d'exception sur ce champ », le modèle fait foi.
--
-- ⚠️ La matérialisation (materialize_due_recurring) FIGE ces valeurs dans la ligne réelle au
-- moment où l'occurrence devient échue — même principe que `override_amount`.
-- ============================================================================

ALTER TABLE public.transaction_month_overrides
  ADD COLUMN IF NOT EXISTS override_note TEXT,
  ADD COLUMN IF NOT EXISTS override_category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.transaction_month_overrides.override_note IS
  'Libellé de CETTE échéance uniquement (NULL = celui de la série).';
COMMENT ON COLUMN public.transaction_month_overrides.override_category_id IS
  'Catégorie de CETTE échéance uniquement (NULL = celle de la série).';
COMMENT ON COLUMN public.transaction_month_overrides.override_account_id IS
  'Compte de CETTE échéance uniquement (NULL = celui de la série).';

-- ── Matérialisation : figer aussi ces champs dans la ligne réelle ──────────────────────────────
-- Reprise intégrale de la fonction (migration 160) : seules changent la lecture de l'override
-- (on lit désormais la LIGNE entière, plus seulement le montant) et les valeurs insérées.
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

NOTIFY pgrst, 'reload schema';
