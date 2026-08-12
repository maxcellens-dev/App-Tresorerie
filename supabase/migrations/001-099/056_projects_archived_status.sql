-- Migration 056 : Autoriser le statut 'archived' pour les projets.
--
-- La contrainte CHECK d'origine (migration 006/007) n'autorisait que
-- ('active', 'completed', 'on_hold') → toute mise à jour vers 'archived' était
-- rejetée par la base, d'où l'impossibilité d'archiver un projet (auto ou manuel).

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'completed', 'on_hold', 'archived'));
