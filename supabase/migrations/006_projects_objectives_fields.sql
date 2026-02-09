-- ============================================================
-- Projects and Objectives: Enhanced fields for better planning
-- ============================================================

-- Projects table (if it doesn't exist, create it)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_amount NUMERIC(14, 2) NOT NULL,
  monthly_allocation NUMERIC(14, 2),
  target_date DATE,
  linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  current_accumulated NUMERIC(14, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if table already exists
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS target_date DATE,
  ADD COLUMN IF NOT EXISTS linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_accumulated NUMERIC(14, 2) DEFAULT 0;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own projects"
  ON projects FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX IF NOT EXISTS idx_projects_profile ON projects(profile_id);
CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(linked_account_id);

-- Objectives table (if it doesn't exist, create it)
CREATE TABLE IF NOT EXISTS objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_yearly_amount NUMERIC(14, 2) NOT NULL,
  linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  current_year_invested NUMERIC(14, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if table already exists
ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS current_year_invested NUMERIC(14, 2) DEFAULT 0;

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own objectives"
  ON objectives FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX IF NOT EXISTS idx_objectives_profile ON objectives(profile_id);
CREATE INDEX IF NOT EXISTS idx_objectives_account ON objectives(linked_account_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER objectives_updated_at
  BEFORE UPDATE ON objectives
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
