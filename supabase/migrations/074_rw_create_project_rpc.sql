-- Création de projet via RPC SECURITY DEFINER : owner_id = auth.uid() côté serveur,
-- et insertions faites par le propriétaire des tables → pas de dépendance aux policies
-- d'INSERT / au RETURNING (qui posaient problème). Ajoute aussi le créateur en participant.
CREATE OR REPLACE FUNCTION public.rw_create_project(p_name text, p_emoji text, p_desc text, p_myname text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; pid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Nom requis'; END IF;
  INSERT INTO public.rw_projects(owner_id, name, emoji, description)
    VALUES (uid, trim(p_name), coalesce(nullif(p_emoji, ''), '💸'), coalesce(p_desc, ''))
    RETURNING id INTO pid;
  INSERT INTO public.rw_participants(project_id, user_id, display_name)
    VALUES (pid, uid, coalesce(nullif(trim(p_myname), ''), 'Moi'));
  RETURN pid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rw_create_project(text, text, text, text) TO authenticated;
