-- ============================================================================
-- 158 — Admin : lister les utilisateurs INACTIFs (pour purge en masse).
--
-- « Inactif depuis N mois » = dernière activité (max analytics_events.created_at) plus vieille que
-- N mois ; à défaut d'activité tracée, on se base sur la date de création du compte. On EXCLUT
-- toujours l'appelant et les autres admins. Réservé aux admins (is_app_admin).
--
-- La SUPPRESSION elle-même passe par l'Edge Function `admin-delete-users` (service role → API Auth
-- admin) : supprimer l'utilisateur Auth CASCADE toutes ses données (profiles → tout, ON DELETE CASCADE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_inactive_users(p_min_months int)
RETURNS TABLE(id uuid, email text, full_name text, created_at timestamptz, last_active timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.created_at, la.last_active
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS last_active FROM public.analytics_events a WHERE a.profile_id = p.id
    ) la ON true
    WHERE p.id <> auth.uid()                       -- jamais soi-même
      AND COALESCE(p.is_admin, false) = false       -- jamais un admin
      AND COALESCE(la.last_active, p.created_at) < now() - make_interval(months => GREATEST(1, p_min_months))
    ORDER BY COALESCE(la.last_active, p.created_at) ASC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_inactive_users(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
