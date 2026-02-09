-- ============================================================
-- MyTreasury - Initial Schema (Supabase)
-- Offline-First: app_config singleton for Remote Config
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. APP_CONFIG (Singleton - Remote Config)
-- ============================================================
CREATE TABLE app_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  theme JSONB NOT NULL DEFAULT '{
    "colors": {
      "primary": "#2563eb",
      "secondary": "#64748b",
      "background": "#ffffff",
      "surface": "#f8fafc",
      "text": "#0f172a",
      "textMuted": "#64748b",
      "success": "#22c55e",
      "warning": "#f59e0b",
      "danger": "#ef4444"
    },
    "fonts": {
      "heading": "System",
      "body": "System"
    }
  }'::jsonb,
  navigation JSONB NOT NULL DEFAULT '{
    "tabs": ["home", "transactions", "accounts", "settings"],
    "labels": {}
  }'::jsonb,
  texts JSONB NOT NULL DEFAULT '{
    "appName": "MyTreasury",
    "tagline": "Your financial health at a glance",
    "seo": {}
  }'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default singleton row
INSERT INTO app_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- RLS: Public read for app_config (needed for offline sync)
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read app_config"
  ON app_config FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated update app_config"
  ON app_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  safety_threshold NUMERIC(14, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- 3. ACCOUNTS
-- ============================================================
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking',
  currency TEXT NOT NULL DEFAULT 'EUR',
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own accounts"
  ON accounts FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX idx_accounts_profile ON accounts(profile_id);

-- ============================================================
-- 4. CATEGORIES
-- ============================================================
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own categories"
  ON categories FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX idx_categories_profile ON categories(profile_id);

-- ============================================================
-- 5. TRANSACTIONS (with is_forecast, is_reconciled)
-- ============================================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL,
  date DATE NOT NULL,
  note TEXT,
  is_forecast BOOLEAN NOT NULL DEFAULT false,
  is_reconciled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own transactions"
  ON transactions FOR ALL
  USING (auth.uid() = profile_id);

CREATE INDEX idx_transactions_profile ON transactions(profile_id);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_forecast ON transactions(is_forecast);

-- ============================================================
-- 6. ADMIN_LOGS (analytics / audit)
-- ============================================================
CREATE TABLE admin_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only service role or authenticated admins"
  ON admin_logs FOR ALL
  USING (auth.role() = 'service_role' OR auth.jwt() ->> 'role' = 'admin');

CREATE INDEX idx_admin_logs_created ON admin_logs(created_at);

-- ============================================================
-- Triggers: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- Trigger: Create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
