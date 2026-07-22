-- ============================================================================
-- 157 — log_client_error : ne fait QUE journaliser (la notif admin passe par `notify-admins`).
--
-- La 155 faisait l'insertion admin_notifications DANS le RPC (in-app seulement, pas de push). On
-- unifie : le BADGE admin vient du compteur d'erreurs non résolues (client_errors), et le PUSH + la
-- ligne d'historique passent par l'Edge Function `notify-admins` (kind='crash'), déclenchée par le
-- client après remontée — comme les 3 autres types (assistance/suggestion/ticket IA). Ainsi les 4
-- notifications admin poussent par le même chemin (respect des préférences push par admin).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_client_error(
  p_kind text, p_message text, p_stack text DEFAULT NULL, p_route text DEFAULT NULL,
  p_platform text DEFAULT NULL, p_app_version text DEFAULT NULL, p_runtime_version text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN RETURN; END IF;
  INSERT INTO public.client_errors (profile_id, platform, app_version, runtime_version, kind, message, stack, route, context)
  VALUES (
    auth.uid(),
    left(COALESCE(p_platform, ''), 16),
    left(COALESCE(p_app_version, ''), 32),
    left(COALESCE(p_runtime_version, ''), 32),
    CASE WHEN p_kind IN ('error','fatal','unhandled_rejection') THEN p_kind ELSE 'error' END,
    left(p_message, 2000),
    left(COALESCE(p_stack, ''), 8000),
    left(COALESCE(p_route, ''), 200),
    p_context
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
