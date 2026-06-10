-- Migration 058 : Accès admin complet aux données utilisateur (mode « connecté en tant que »).
--
-- Permet à un administrateur de CONSULTER et MODIFIER les données de n'importe quel
-- utilisateur (support / intervention), sans changer d'authentification.
-- On ajoute, sur chaque table par-utilisateur, une politique RLS « admin = accès total »
-- qui s'ajoute (OR) aux politiques « self » existantes.

-- Fonction utilitaire : l'appelant est-il admin ? (SECURITY DEFINER → contourne le RLS de profiles, pas de récursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- Politique « admin accès total » sur chaque table de données par-utilisateur.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'profiles', 'accounts', 'transactions', 'categories', 'projects', 'objectives',
    'reservations', 'pre_savings', 'month_closures', 'user_financial_profile',
    'user_gamification', 'user_badges', 'user_inventory', 'user_conseil_seen',
    'user_questionnaire_answers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())',
        t || '_admin_all', t
      );
    END IF;
  END LOOP;
END $$;
