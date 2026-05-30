-- ─────────────────────────────────────────────────────────────
-- 024 — Suppression de son propre compte par l'utilisateur
-- ─────────────────────────────────────────────────────────────
-- Fonction RPC SECURITY DEFINER : un utilisateur authentifié peut
-- supprimer SON propre compte. La suppression de auth.users cascade
-- vers profiles puis vers toutes ses données (FK ON DELETE CASCADE).

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  -- Supprimer explicitement les données applicatives (au cas où certaines FK
  -- ne seraient pas en ON DELETE CASCADE), puis l'utilisateur auth lui-même.
  DELETE FROM transactions               WHERE profile_id = uid;
  DELETE FROM transaction_month_overrides WHERE profile_id = uid;
  DELETE FROM projects                   WHERE profile_id = uid;
  DELETE FROM objectives                 WHERE profile_id = uid;
  DELETE FROM categories                 WHERE profile_id = uid;
  DELETE FROM accounts                   WHERE profile_id = uid;
  DELETE FROM user_financial_profile     WHERE user_id = uid;
  DELETE FROM user_questionnaire_answers WHERE user_id = uid;
  DELETE FROM profile_change_log         WHERE user_id = uid;
  DELETE FROM suggestions                WHERE profile_id = uid;
  DELETE FROM profiles                   WHERE id = uid;

  -- Suppression du compte d'authentification (cascade finale)
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;
