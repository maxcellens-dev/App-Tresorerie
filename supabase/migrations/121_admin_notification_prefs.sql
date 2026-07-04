-- ============================================================================
-- 121 — Préférences de notifications ADMIN (assistance / suggestions / tickets IA).
-- Chaque admin choisit, par type d'événement, s'il veut le badge IN-APP et/ou un PUSH.
-- L'ENVOI push effectif sera branché avec les crons/Edge Functions (fin de chantier) ;
-- cette table est déjà la source de vérité du ciblage.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_notification_prefs (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('support', 'suggestion', 'ai_ticket')),
  in_app boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, kind)
);

ALTER TABLE public.admin_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Lecture/écriture réservées aux admins (chaque admin peut voir/régler les prefs de tous les
-- admins depuis la page Notifications — c'est un réglage d'équipe, pas un secret).
DROP POLICY IF EXISTS admin_notif_prefs_all ON public.admin_notification_prefs;
CREATE POLICY admin_notif_prefs_all ON public.admin_notification_prefs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
