-- Migration 093 : régularisation de solde DÉTERMINISTE (ancrage sur regul_target).
--
-- Bug constaté : on saisit un nouveau solde cible (ex. 3130 €) mais le solde recalculé
-- ne tombe pas dessus ; il faut refaire une 2ᵉ régul identique pour y arriver.
--
-- Cause : la régul était stockée comme un simple DELTA (amount = cible − solde affiché),
-- puis recompute_account_balance() RE-SOMMAIT tout l'historique en appliquant des règles
-- d'exclusion (transaction « couverte » le jour de la régul, ou datée avant mais saisie
-- après). Or l'insertion de la régul — et la matérialisation d'occurrences récurrentes du
-- même jour, qui posent regul_covered=true — change APRÈS COUP l'ensemble des transactions
-- exclues. Le delta, calculé contre l'ancien solde, ne retombe donc plus sur la cible.
--
-- Correctif : la DERNIÈRE régularisation devient une ANCRE. Le solde =
--     regul_target (le solde voulu À la date/heure de la régul)
--   + Σ(transactions strictement POSTÉRIEURES à la régul, échues ≤ aujourd'hui).
-- Tout ce qui précède la régul est subsumé par la cible → plus aucune dérive possible :
-- une régul atteint TOUJOURS exactement sa cible, quel que soit l'historique.
--
-- Repli : si la dernière régul n'a pas de regul_target (anciennes « Ajustement de solde »
-- d'avant la colonne regul_target), on conserve l'ancien calcul (somme + exclusions).

CREATE OR REPLACE FUNCTION recompute_account_balance(p_account UUID, p_today DATE DEFAULT current_date)
RETURNS VOID
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
    AND category_id IS NULL
    AND (note ILIKE '%gul%' OR note = 'Ajustement de solde')
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  IF v_regul_id IS NOT NULL AND v_regul_target IS NOT NULL THEN
    -- ── Modèle ANCRE : cible + transactions strictement postérieures à la régul ──
    -- « Postérieures » = datées après la régul, OU le même jour mais saisies après elle
    -- et NON déjà incluses (regul_covered). Tout le reste (avant/au moment de la régul,
    -- y compris la régul elle-même) est subsumé par regul_target.
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
        AND NOT (tx.category_id IS NULL AND (tx.note ILIKE '%gul%' OR tx.note = 'Ajustement de solde'))
        AND (
          (tx.date < v_regul_date AND tx.created_at > v_regul_created)
          OR (tx.date = v_regul_date AND COALESCE(tx.regul_covered, false))
        )
      );
  END IF;

  UPDATE accounts SET balance = v_bal WHERE id = p_account;
END;
$$;
