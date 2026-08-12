-- Migration 173 : recompute_account_balance() RENVOIE le solde recalculé.
--
-- Le client appelait ce RPC après chaque écriture, puis invalidait `accounts` pour… relire le
-- chiffre que la fonction venait de calculer. Un aller-retour réseau complet, systématique, juste
-- pour rapatrier une valeur que le serveur avait déjà sous la main — et pendant ce temps l'écran
-- affichait l'ANCIEN solde comme s'il était définitif.
--
-- La fonction renvoie donc désormais le solde qu'elle vient d'écrire : le client patche son cache
-- immédiatement (le solde bouge dans la foulée de la saisie) et le refetch ne fait plus que
-- confirmer. Aucun appelant n'est cassé : en PostgREST, ignorer la valeur de retour d'un RPC est
-- parfaitement valide — VOID devient NUMERIC, la signature (p_account, p_today) ne change pas.
--
-- Le CORPS est identique à la migration 093 (modèle d'ancre sur regul_target + repli historique) :
-- seuls le type de retour et le RETURN final changent.
--
-- ⚠️ CREATE OR REPLACE ne sait PAS changer un type de retour → il faut DROP d'abord. Les autres
-- fonctions SQL qui l'appellent le font en PERFORM (compatible avec une valeur de retour) et ne
-- gardent aucune dépendance figée. En revanche le DROP emporte SECURITY DEFINER et le GRANT
-- (migration 096) : ils sont donc RÉAPPLIQUÉS plus bas — sans quoi tout participant non
-- propriétaire d'un compte partagé se retrouverait en 403 à la première écriture.

DROP FUNCTION IF EXISTS public.recompute_account_balance(uuid, date);

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
    AND category_id IS NULL
    AND (note ILIKE '%gul%' OR note = 'Ajustement de solde')
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
        AND NOT (tx.category_id IS NULL AND (tx.note ILIKE '%gul%' OR tx.note = 'Ajustement de solde'))
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

-- Rétablit ce que le DROP a emporté (cf. migration 096).
ALTER FUNCTION public.recompute_account_balance(uuid, date) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.recompute_account_balance(uuid, date) TO authenticated;
