-- Migration 017 : Ajout du type de planification sur les projets
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS allocation_type TEXT NOT NULL DEFAULT 'monthly'
  CHECK (allocation_type IN ('monthly', 'date', 'ponctuel'));
