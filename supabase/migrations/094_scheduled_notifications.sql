-- Notifications PLANIFIÉES (admin) : envoi ponctuel (date+heure) ou périodique (quotidien / hebdo /
-- mensuel, à une heure donnée). Le DÉCLENCHEMENT est fait par l'Edge Function
-- `send-scheduled-notifications`, appelée ~chaque minute par cron-job.org (même principe que
-- `refresh-currency-rates`). La GESTION (CRUD) se fait dans l'écran admin Notifications.

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('once', 'recurring')),
  -- Ponctuel (kind='once')
  trigger_at TIMESTAMPTZ,                 -- instant absolu de déclenchement
  -- Périodique (kind='recurring')
  recurrence TEXT CHECK (recurrence IN ('daily', 'weekly', 'monthly')),
  time_of_day TEXT,                       -- 'HH:MM' (heure LOCALE de déclenchement)
  day_of_week SMALLINT,                   -- 0=dimanche … 6=samedi (recurrence='weekly')
  day_of_month SMALLINT,                  -- 1..31 (recurrence='monthly' ; borné au dernier jour du mois)
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,               -- dernier envoi (anti double-envoi : 1×/jour max pour les périodiques)
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_active ON scheduled_notifications(active);

ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Admin uniquement (CRUD). L'Edge Function utilise la SERVICE ROLE (bypass RLS) pour lire/envoyer.
DROP POLICY IF EXISTS "scheduled_notifications_all" ON scheduled_notifications;
CREATE POLICY "scheduled_notifications_all" ON scheduled_notifications FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- Tracer l'origine d'un envoi dans l'historique (null = envoi manuel immédiat).
ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS scheduled_id UUID REFERENCES scheduled_notifications(id) ON DELETE SET NULL;
-- Type/source de l'envoi : 'manual' (immédiat) | 'once' (planif ponctuelle) | 'recurring' (planif périodique).
ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS source TEXT;
