-- ============================================================
-- Categories: parent_id (sous-catégories), récurrence, is_admin
-- ============================================================

-- Categories: sous-catégories (parent_id)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Transactions: récurrent (période, sans fin)
-- recurrence_rule: 'monthly' | 'yearly' | 'weekly' | 'quarterly'
-- recurrence_end_date: NULL = sans fin
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT CHECK (recurrence_rule IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;

-- Profiles: admin (accès panneau admin)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Marquer maxcellens@gmail.com comme admin
UPDATE profiles SET is_admin = true WHERE email = 'maxcellens@gmail.com';

-- Trigger: set is_admin on profile insert/update email
CREATE OR REPLACE FUNCTION set_admin_on_profile()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_admin := (COALESCE(NEW.email, '') = 'maxcellens@gmail.com');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_admin_on_profile_trigger ON profiles;
CREATE TRIGGER set_admin_on_profile_trigger
  BEFORE INSERT OR UPDATE OF email ON profiles
  FOR EACH ROW EXECUTE PROCEDURE set_admin_on_profile();

-- handle_new_user: inclure is_admin à la création
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    (COALESCE(NEW.email, '') = 'maxcellens@gmail.com')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    is_admin = EXCLUDED.is_admin;
  RETURN NEW;
END;
$$;
