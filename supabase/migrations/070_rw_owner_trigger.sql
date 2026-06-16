-- Robustesse : owner_id d'un projet Relyka World est TOUJOURS l'utilisateur authentifié
-- (auth.uid()), côté serveur. Évite l'échec RLS quand un admin crée en mode « connecté
-- en tant que » (où user.id côté app ≠ auth.uid() de la session).
CREATE OR REPLACE FUNCTION public.rw_set_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.owner_id := auth.uid();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rw_projects_owner ON public.rw_projects;
CREATE TRIGGER trg_rw_projects_owner BEFORE INSERT ON public.rw_projects
  FOR EACH ROW EXECUTE FUNCTION public.rw_set_owner();
