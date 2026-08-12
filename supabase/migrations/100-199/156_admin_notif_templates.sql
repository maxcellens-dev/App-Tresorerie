-- ============================================================================
-- 156 — Contenu ÉDITABLE des notifications admin événementielles (assistance / suggestion / ticket IA).
--
-- Le titre et le message de ces notifications étaient codés en dur côté client. On les stocke dans
-- `app_config.admin_notif_templates` (éditables dans Admin → Notifications → onglet Admin). Les Edge
-- Functions `notify-admins` (support/suggestion) et `ai-advice` (ticket IA) lisent ces gabarits.
-- (Le crash a son propre `app_config.crash_notify`, cf. migration 155.)
-- ============================================================================

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS admin_notif_templates jsonb NOT NULL DEFAULT '{
    "support":    {"title": "Nouvelle demande d''assistance", "body": "Un utilisateur a envoyé une demande de support."},
    "suggestion": {"title": "Nouvelle suggestion",            "body": "Un utilisateur a proposé une idée."},
    "ai_ticket":  {"title": "Conseil IA en échec",            "body": "Une demande de conseil a échoué et attend une relance."}
  }'::jsonb;

NOTIFY pgrst, 'reload schema';
