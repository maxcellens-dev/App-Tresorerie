-- ============================================================================
-- 161 — Admin : rechercher N'IMPORTE QUEL utilisateur (actif ou non) pour la purge.
--
-- L'onglet « Inactifs » ne savait lister que les comptes dormants (158). Il faut aussi pouvoir
-- viser quelqu'un de précis — un compte de test, un doublon, une demande de suppression — qui est
-- peut-être ACTIF, donc absent de cette liste.
--
-- Volontairement la MÊME forme de retour et les MÊMES exclusions que `list_inactive_users` :
--   • jamais soi-même, jamais un autre admin → un compte protégé ne peut même pas être coché ;
--   • `last_active` renvoyé aussi, pour qu'on VOIE qu'on s'apprête à supprimer un compte actif.
-- Réservé aux admins (is_app_admin), comme 158. La suppression elle-même reste l'Edge Function
-- `admin-delete-users` (service role), qui refait ces contrôles côté serveur.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_users_admin(p_query text)
RETURNS TABLE(id uuid, email text, full_name text, created_at timestamptz, last_active timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_like text;
BEGIN
  IF NOT public.is_app_admin() THEN RETURN; END IF;
  IF p_query IS NULL OR length(btrim(p_query)) < 2 THEN RETURN; END IF;
  v_like := '%' || btrim(p_query) || '%';

  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.created_at, la.last_active
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS last_active FROM public.analytics_events a WHERE a.profile_id = p.id
    ) la ON true
    WHERE p.id <> auth.uid()                        -- jamais soi-même
      AND COALESCE(p.is_admin, false) = false        -- jamais un admin
      AND (p.email ILIKE v_like OR p.full_name ILIKE v_like)
    ORDER BY COALESCE(la.last_active, p.created_at) DESC
    LIMIT 50;
END; $$;
GRANT EXECUTE ON FUNCTION public.search_users_admin(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
