-- ============================================================================
-- 119 — Lecture ADMIN des données nécessaires au « Snapshot » admin (générer l'instantané d'un user).
-- accounts/transactions/credits/overrides/credit_events ont déjà le bypass admin (101/102/104/110).
-- Il manque : categories, projects, objectives, questionnaire. On ajoute des policies ADMIN-ONLY en
-- lecture (permissives → OU-ées avec les policies user existantes, qu'on ne touche pas).
-- ============================================================================
DROP POLICY IF EXISTS categories_admin_read ON public.categories;
CREATE POLICY categories_admin_read ON public.categories FOR SELECT USING (is_app_admin());

DROP POLICY IF EXISTS projects_admin_read ON public.projects;
CREATE POLICY projects_admin_read ON public.projects FOR SELECT USING (is_app_admin());

DROP POLICY IF EXISTS objectives_admin_read ON public.objectives;
CREATE POLICY objectives_admin_read ON public.objectives FOR SELECT USING (is_app_admin());

DROP POLICY IF EXISTS questionnaire_admin_read ON public.user_questionnaire_answers;
CREATE POLICY questionnaire_admin_read ON public.user_questionnaire_answers FOR SELECT USING (is_app_admin());

NOTIFY pgrst, 'reload schema';
