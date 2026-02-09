-- ============================================================
-- MyTreasury - Admin "God Mode" & user_activity
-- ============================================================

-- Add columns to app_config for Admin Panel
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS theme_config JSONB DEFAULT '{
    "primaryColor": "#34d399",
    "secondaryColor": "#64748b",
    "fontFamily": "System",
    "buttonRadius": 12
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS seo_config JSONB DEFAULT '{
    "landingTitle": "MyTreasury",
    "landingDescription": "Gérez votre trésorerie en toute sérénité.",
    "metaTags": {}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS menu_structure JSONB DEFAULT '{
    "tabs": ["home", "transactions", "accounts", "settings"],
    "labels": {}
  }'::jsonb;

-- user_activity for Stats Hub (DAU, cash managed, etc.)
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_created ON user_activity(created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id);

ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role and authenticated read user_activity"
  ON user_activity FOR SELECT
  USING (auth.role() = 'service_role' OR auth.uid() = user_id);

CREATE POLICY "Allow insert user_activity"
  ON user_activity FOR INSERT
  WITH CHECK (true);
