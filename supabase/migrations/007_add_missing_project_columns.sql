-- Add missing columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_accumulated NUMERIC DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
