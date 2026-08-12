-- Migration 082 : archivage des projets partagés (Relyka World).
--
-- Un projet partagé dont au moins une dépense a déjà impacté un VRAI compte (transaction passée)
-- ne peut plus être supprimé (cela laisserait des écritures réelles orphelines chez les membres).
-- On permet alors de l'ARCHIVER (le masquer de la liste active) au lieu de le supprimer.
-- archived_at NULL = projet actif ; non-NULL = archivé.

ALTER TABLE public.rw_projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- La policy UPDATE owner (migration 069) couvre déjà l'archivage/désarchivage par le propriétaire.
