-- Add project_id to transactions to link transactions to projects
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- Index for efficient project-transaction lookups
CREATE INDEX IF NOT EXISTS idx_transactions_project_id ON transactions(project_id) WHERE project_id IS NOT NULL;
