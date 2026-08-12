-- ============================================================================
-- 112 — Crédits partagés : les invitations doivent être visibles par l'ADMIN en mode consultation
-- (« connecté en tant que »). Le RPC utilisait auth.uid() (= l'admin) → on ajoute un user cible que
-- seul l'admin peut viser. Un user normal reste limité à ses propres invitations.
-- ============================================================================
DROP FUNCTION IF EXISTS public.credit_my_invitations();
CREATE OR REPLACE FUNCTION public.credit_my_invitations(p_user uuid DEFAULT NULL)
RETURNS TABLE (invite_id uuid, credit_id uuid, credit_label text, role text, from_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.credit_id, c.label, i.role, COALESCE(p.full_name,'Un utilisateur'), i.created_at
  FROM public.credit_invitations i
  JOIN public.credits c ON c.id = i.credit_id
  LEFT JOIN public.profiles p ON p.id = i.from_user_id
  WHERE i.status = 'pending'
    AND i.to_user_id = CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END
  ORDER BY i.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.credit_my_invitations(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
