-- Migration 088 : appariement robuste des jambes de virement (prérequis multi-devises Phase 3).
--
-- Jusqu'ici les 2 jambes d'un virement étaient appariées par montant exactement opposé
-- (amount = −amount). En virement CROSS-DEVISES, le débit (−X EUR) et le crédit (+Y CHF) ont des
-- montants différents → cet appariement casse. On ajoute un identifiant de groupe partagé par les
-- 2 jambes : appariement fiable, indépendant du montant et de la devise.
--
-- Rétro-compat : les anciens virements n'ont pas de transfer_group_id ; le code retombe alors sur
-- l'heuristique existante (relation de comptes), qui reste correcte pour eux (mono-devise, miroir).

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group
  ON transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
