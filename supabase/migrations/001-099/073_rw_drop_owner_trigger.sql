-- CORRECTIF : le trigger rw_set_owner (070/071) écrasait owner_id avec auth.uid()
-- évalué dans un contexte SECURITY DEFINER où il renvoyait NULL → l'INSERT violait
-- alors la policy WITH CHECK (owner_id = auth.uid()). On le supprime : l'app fournit
-- déjà owner_id = auth.uid() (via supabase.auth.getUser()), ce que la policy vérifie.
DROP TRIGGER IF EXISTS trg_rw_projects_owner ON public.rw_projects;
DROP FUNCTION IF EXISTS public.rw_set_owner();
