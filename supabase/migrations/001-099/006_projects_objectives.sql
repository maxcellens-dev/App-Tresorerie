-- ============================================================
-- Projects & Objectives Tables
-- ============================================================

-- PROJECTS TABLE
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_amount NUMERIC(14, 2) NOT NULL,
  monthly_allocation NUMERIC(14, 2),
  target_date DATE,
  linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  current_accumulated NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_profile ON projects(profile_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating
DROP POLICY IF EXISTS "Users can CRUD own projects" ON projects;
CREATE POLICY "Users can CRUD own projects"
  ON projects FOR ALL
  USING (auth.uid() = profile_id);

-- OBJECTIVES TABLE
CREATE TABLE IF NOT EXISTS objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_yearly_amount NUMERIC(14, 2) NOT NULL,
  category TEXT CHECK (category IN ('Objectif annuel', 'Investissement', 'Autre')),
  current_year_invested NUMERIC(14, 2) DEFAULT 0,
  linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objectives_profile ON objectives(profile_id);

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating
DROP POLICY IF EXISTS "Users can CRUD own objectives" ON objectives;
CREATE POLICY "Users can CRUD own objectives"
  ON objectives FOR ALL
  USING (auth.uid() = profile_id);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS objectives_updated_at ON objectives;
CREATE TRIGGER objectives_updated_at
  BEFORE UPDATE ON objectives
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
