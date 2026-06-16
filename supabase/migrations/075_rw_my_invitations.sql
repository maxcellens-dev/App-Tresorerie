-- Invitations reçues, enrichies du nom/emoji du projet et du nom de l'invitant.
-- SECURITY DEFINER : l'invité n'a pas encore accès au projet (RLS) tant qu'il n'a pas accepté.
CREATE OR REPLACE FUNCTION public.rw_my_invitations()
RETURNS TABLE(id uuid, project_id uuid, project_name text, project_emoji text, from_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.project_id, p.name, p.emoji,
         coalesce(nullif(trim(pr.full_name), ''), 'Un utilisateur'),
         i.created_at
  FROM public.rw_invitations i
  JOIN public.rw_projects p ON p.id = i.project_id
  LEFT JOIN public.profiles pr ON pr.id = i.from_user_id
  WHERE i.to_user_id = auth.uid() AND i.status = 'pending'
  ORDER BY i.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.rw_my_invitations() TO authenticated;
