-- ============================================================================
-- 181 — SOLDE : l'ancre de régularisation ne peut pas être datée dans le FUTUR.
--
-- `recompute_account_balance` choisit comme ancre « la dernière régularisation du compte », triée
-- par date décroissante — SANS borne haute. Une régularisation datée de demain (date saisie à la
-- main, faute de frappe sur l'année, mode « je ne sais pas » avec une date postérieure à
-- aujourd'hui) devenait donc l'ancre du jour, et le solde valait :
--       cible + somme des transactions POSTÉRIEURES à cette date ET antérieures à aujourd'hui
--     = cible + 0
-- Autrement dit : le compte affichait brutalement un solde futur, en écrasant tout l'historique
-- réel. Un seul chiffre faux de ce genre suffit à faire douter de toute l'application.
--
-- La correction tient en une ligne — l'ancre doit être ÉCHUE, comme les transactions qu'on somme
-- au-dessus d'elle. Une régularisation datée de demain reprendra son rôle demain, naturellement.
--
-- Le reste du corps est identique à la migration 175 (prédicat is_regul_tx + modèle d'ancre +
-- repli historique) : recopié tel quel pour que la fonction reste lisible d'un bloc.
-- ============================================================================

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
  -- Dernière régularisation ÉCHUE (date + instant de saisie + cible).
  SELECT id, date, created_at, regul_target
    INTO v_regul_id, v_regul_date, v_regul_created, v_regul_target
  FROM transactions
  WHERE account_id = p_account
    AND COALESCE(is_draft, false) = false
    AND date <= p_today                       -- ⬅ une ancre future ne dit rien du solde d'aujourd'hui
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

ALTER FUNCTION public.recompute_account_balance(uuid, date) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.recompute_account_balance(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
