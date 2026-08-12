-- Diagnostic : renvoie ce que la base voit pour la session courante
-- (auth.uid() réel + rôle PostgREST). Permet de comprendre l'échec RLS.
CREATE OR REPLACE FUNCTION public.rw_whoami() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT 'uid=' || coalesce(auth.uid()::text, 'NULL') || ' | role=' || current_user;
$$;
GRANT EXECUTE ON FUNCTION public.rw_whoami() TO authenticated, anon;
