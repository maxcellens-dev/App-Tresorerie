-- ============================================================================
-- 114 — Conseils IA : option pour couper UNIQUEMENT la notification push admin des tickets.
-- Les badges in-app (compte de tickets ouverts) et l'historique restent actifs.
-- ============================================================================
ALTER TABLE public.ai_config ADD COLUMN IF NOT EXISTS notify_admins_push boolean NOT NULL DEFAULT true;

-- Temps réel : le fil de chat doit se rafraîchir tout seul (réponse admin, relance…).
-- Ajout idempotent de ai_messages à la publication Realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_messages;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
