-- Global admin settings for recommendation tier allocations.
-- One row per (tier, type). Only admins can write; all authenticated users can read.
CREATE TABLE IF NOT EXISTS recommendation_tier_allocations (
  tier  TEXT NOT NULL,
  type  TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tier, type)
);

-- Seed with default values matching the hardcoded engine defaults
INSERT INTO recommendation_tier_allocations (tier, type, value) VALUES
  ('critical',      'save',   60),
  ('critical',      'invest',  0),
  ('critical',      'enjoy',  10),
  ('critical',      'keep',   30),
  ('below_optimal', 'save',   40),
  ('below_optimal', 'invest', 15),
  ('below_optimal', 'enjoy',  20),
  ('below_optimal', 'keep',   25),
  ('healthy',       'save',   20),
  ('healthy',       'invest', 30),
  ('healthy',       'enjoy',  25),
  ('healthy',       'keep',   25),
  ('comfortable',   'save',   15),
  ('comfortable',   'invest', 40),
  ('comfortable',   'enjoy',  25),
  ('comfortable',   'keep',   20)
ON CONFLICT (tier, type) DO NOTHING;

-- RLS: public read, admin write handled at app level via service role / admin check
ALTER TABLE recommendation_tier_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read tier allocations"
  ON recommendation_tier_allocations FOR SELECT
  USING (true);

CREATE POLICY "authenticated can upsert tier allocations"
  ON recommendation_tier_allocations FOR ALL
  USING (auth.role() = 'authenticated');
