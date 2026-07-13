-- Migration 139 : modes d'un projet personnel
--
-- Un projet perso finance son objectif de 3 façons (choisies à la création, FIGÉES ensuite) :
--   • 'transfer' — « Mettre de côté »        : virements (brouillons) vers un compte épargne/invest ;
--   • 'reserve'  — « Conserver pour plus tard » : réservation sur le MÊME compte (aucun virement réel) ;
--   • 'spend'    — « Dépenser petit à petit » : de VRAIES dépenses catégorisées sur un compte.
--
-- Le mode est figé après création : le changer reviendrait à réinterpréter des transactions
-- déjà générées (et, pour 'spend', déjà portées au solde).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'transfer'
  CHECK (mode IN ('transfer', 'reserve', 'spend'));

-- Catégorie des dépenses générées par un projet 'spend' (NULL pour les autres modes).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS expense_category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- Reprise de l'existant : même compte en source et destination = réservation ; sinon virement.
UPDATE projects
   SET mode = 'reserve'
 WHERE source_account_id IS NOT NULL
   AND source_account_id = linked_account_id
   AND mode <> 'reserve';
