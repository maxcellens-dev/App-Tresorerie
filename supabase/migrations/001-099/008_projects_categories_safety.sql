-- Add source_account_id and transaction_day to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaction_day INT CHECK (transaction_day >= 1 AND transaction_day <= 28);

-- Add is_variable flag to categories (for variable/fixed expense tracking)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_variable BOOLEAN DEFAULT false;

-- Add is_default flag to categories (non-admin protection)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

-- Add safety_margin_percent to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS safety_margin_percent NUMERIC DEFAULT 10;
