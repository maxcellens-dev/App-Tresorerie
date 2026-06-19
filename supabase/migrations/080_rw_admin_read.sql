-- Migration 080 : accès ADMIN en LECTURE aux données Relyka World (projets partagés).
--
-- En mode « connecté en tant que », le token reste celui de l'admin → la RLS membre
-- (rw_can_access basée sur auth.uid()) ne laisse pas voir les projets du user visité.
-- On ajoute une policy SELECT « admin » (OR avec les policies membres existantes) sur chaque
-- table rw_*, pour permettre la CONSULTATION des projets partagés d'un utilisateur.
-- Lecture seule volontairement : pas d'écriture admin sur des données partagées par d'autres.
--
-- is_admin() : fonction SECURITY DEFINER déjà définie en migration 058.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'rw_projects', 'rw_participants', 'rw_expenses', 'rw_expense_shares', 'rw_invitations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (is_admin())',
        t || '_admin_read', t
      );
    END IF;
  END LOOP;
END $$;
