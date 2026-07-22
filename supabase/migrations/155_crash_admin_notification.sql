-- ============================================================================
-- 155 — Centre de sécurité : NOTIFICATION ADMIN en cas de crash/erreur client.
--
-- Quand un appareil remonte une erreur (RPC log_client_error), on crée une entrée dans
-- `admin_notifications` (alerte in-app + badge admin, comme les tickets IA), THROTTLÉE pour ne pas
-- inonder en cas de boucle de crash. Titre/corps ÉDITABLES par l'admin (app_config.crash_notify).
--
-- ⚠ In-app uniquement : pas de PUSH serveur (pas de pg_net ici, et un client qui CRASHE ne peut pas
-- pousser lui-même). L'admin voit l'alerte à l'ouverture (badge). L'admin peut couper via `enabled`.
-- ============================================================================

-- 1) Config éditable (titre/corps/throttle). {kind}/{platform}/{version} sont substitués.
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS crash_notify jsonb NOT NULL DEFAULT '{
    "enabled": true,
    "title": "🚨 Erreur détectée dans l''app",
    "body": "Une erreur ({kind}) est remontée depuis {platform} v{version}. Ouvre le Centre de sécurité.",
    "throttle_minutes": 30
  }'::jsonb;

-- 2) Le type « crash » devient un genre de notification admin (préférence push par admin, cohérence UI).
ALTER TABLE public.admin_notification_prefs DROP CONSTRAINT IF EXISTS admin_notification_prefs_kind_check;
ALTER TABLE public.admin_notification_prefs
  ADD CONSTRAINT admin_notification_prefs_kind_check CHECK (kind IN ('support', 'suggestion', 'ai_ticket', 'crash'));

-- 3) log_client_error : insère l'erreur PUIS notifie les admins (throttlé).
CREATE OR REPLACE FUNCTION public.log_client_error(
  p_kind text, p_message text, p_stack text DEFAULT NULL, p_route text DEFAULT NULL,
  p_platform text DEFAULT NULL, p_app_version text DEFAULT NULL, p_runtime_version text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb;
  throttle_min int;
  n_recent int;
  n_title text;
  n_body text;
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

  -- Notification admin (throttlée). Toute erreur avalée ici NE DOIT PAS faire échouer la remontée.
  BEGIN
    SELECT crash_notify INTO cfg FROM public.app_config WHERE id = 'default';
    IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) = false THEN RETURN; END IF;
    throttle_min := GREATEST(1, COALESCE((cfg->>'throttle_minutes')::int, 30));

    SELECT count(*) INTO n_recent FROM public.admin_notifications
      WHERE source = 'crash' AND created_at > now() - make_interval(mins => throttle_min);
    IF n_recent > 0 THEN RETURN; END IF; -- déjà notifié récemment → on n'inonde pas

    n_title := COALESCE(NULLIF(cfg->>'title', ''), '🚨 Erreur détectée dans l''app');
    n_body := COALESCE(NULLIF(cfg->>'body', ''), 'Une erreur ({kind}) est remontée depuis {platform} v{version}.');
    n_body := replace(replace(replace(n_body,
      '{kind}', COALESCE(p_kind, 'error')),
      '{platform}', COALESCE(NULLIF(p_platform, ''), '?')),
      '{version}', COALESCE(NULLIF(p_app_version, ''), '?'));

    INSERT INTO public.admin_notifications (title, body, sent_count, source, target_label)
    VALUES (left(n_title, 120), left(n_body, 240), 0, 'crash', 'Système');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END; $$;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
