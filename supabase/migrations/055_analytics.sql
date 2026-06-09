-- Migration 055 : Analytics d'usage (évènements) pour le Stats Hub admin.
--
-- Chaque utilisateur connecté enregistre ses évènements (ouverture d'app, vue de page…).
-- Lecture réservée aux admins (agrégation côté admin dans le Stats Hub).

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,            -- 'app_open' | 'screen_view' | 'action' …
  screen      TEXT,                     -- nom de page (pour screen_view)
  platform    TEXT,                     -- web | ios | android
  session_id  TEXT,                     -- 1 par ouverture d'app
  meta        JSONB,                    -- détails optionnels
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_created  ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_profile  ON analytics_events(profile_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event    ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_screen   ON analytics_events(screen);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Chacun insère uniquement ses propres évènements.
DROP POLICY IF EXISTS "analytics_insert_self" ON analytics_events;
CREATE POLICY "analytics_insert_self" ON analytics_events FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());

-- Lecture réservée aux admins.
DROP POLICY IF EXISTS "analytics_admin_read" ON analytics_events;
CREATE POLICY "analytics_admin_read" ON analytics_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
