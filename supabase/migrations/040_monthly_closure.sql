-- Clôture mensuelle (fonctionnalité activable via l'admin) + bilan éphémère + verrou temporel.

-- Drapeaux de fonctionnalités globaux (admin)
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Verrou + dernier bilan, par utilisateur
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS closure_lock_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_closure_bilan JSONB;

-- Historique des clôtures mensuelles
CREATE TABLE IF NOT EXISTS month_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month_key TEXT NOT NULL,            -- 'YYYY-MM'
  surplus NUMERIC NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_month_closures_profile ON month_closures(profile_id, month_key);

ALTER TABLE month_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "month_closures_select" ON month_closures;
CREATE POLICY "month_closures_select" ON month_closures FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "month_closures_insert" ON month_closures;
CREATE POLICY "month_closures_insert" ON month_closures FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "month_closures_delete" ON month_closures;
CREATE POLICY "month_closures_delete" ON month_closures FOR DELETE TO authenticated
  USING (auth.uid() = profile_id);
