-- ============================================================
-- MyTreasury - Pilotage Dashboard (Projects & Objectives)
-- ============================================================

-- Step 1: Update profiles table with safety thresholds (idempotent with IF NOT EXISTS)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS safety_threshold_min NUMERIC(14, 2) DEFAULT 5000;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS safety_threshold_optimal NUMERIC(14, 2) DEFAULT 10000;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS safety_threshold_comfort NUMERIC(14, 2) DEFAULT 20000;

-- Step 2: Add parent_id to categories if not exists (for hierarchy)
ALTER TABLE categories
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Step 3: Create PROJECTS table (Stock Logic - One-off Purchases)
-- Uses IF NOT EXISTS to prevent errors if table already exists
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_amount NUMERIC(14, 2) NOT NULL,
  monthly_allocation NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can CRUD own projects" ON projects;

CREATE POLICY "Users can CRUD own projects"
  ON projects FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX IF NOT EXISTS idx_projects_profile ON projects(profile_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Step 4: Create OBJECTIVES table (Flow Logic - Investment Goals)
-- Uses IF NOT EXISTS to prevent errors if table already exists
CREATE TABLE IF NOT EXISTS objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_yearly_amount NUMERIC(14, 2) NOT NULL,
  linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can CRUD own objectives" ON objectives;

CREATE POLICY "Users can CRUD own objectives"
  ON objectives FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX IF NOT EXISTS idx_objectives_profile ON objectives(profile_id);
CREATE INDEX IF NOT EXISTS idx_objectives_account ON objectives(linked_account_id);

-- Step 5: Add triggers for projects updated_at (idempotent)
DROP TRIGGER IF EXISTS projects_updated_at ON projects;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Step 6: Add trigger for objectives updated_at (idempotent)
DROP TRIGGER IF EXISTS objectives_updated_at ON objectives;

CREATE TRIGGER objectives_updated_at
  BEFORE UPDATE ON objectives
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- END
-- ============================================================
