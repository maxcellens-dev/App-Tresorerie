-- Migration 052 : Accès admin aux profils (recherche utilisateurs + passage Premium manuel)
--
-- Fonction SECURITY DEFINER pour éviter la récursion RLS (une policy ON profiles qui
-- interroge profiles provoquerait une boucle ; via une fonction definer, on contourne).

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true);
$$;

-- Les admins peuvent lire tous les profils (recherche).
DROP POLICY IF EXISTS "profiles_admin_select" ON profiles;
CREATE POLICY "profiles_admin_select" ON profiles
  FOR SELECT TO authenticated
  USING (is_admin());

-- Les admins peuvent mettre à jour les profils (ex. is_premium).
DROP POLICY IF EXISTS "profiles_admin_update" ON profiles;
CREATE POLICY "profiles_admin_update" ON profiles
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
