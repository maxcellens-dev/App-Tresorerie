-- Célébration des succès : on mémorise CÔTÉ COMPTE (et non plus en local par appareil) si la
-- célébration d'un succès a déjà été montrée. Ainsi elle ne réapparaît jamais 2× pour le même
-- utilisateur, quel que soit l'appareil ou l'écran depuis lequel il s'est connecté.
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS celebrated_at TIMESTAMPTZ;

-- Rétro-compat : les succès déjà débloqués sont considérés comme déjà célébrés (pas de rejeu
-- rétroactif pour les utilisateurs existants).
UPDATE user_badges SET celebrated_at = COALESCE(unlocked_at, now()) WHERE celebrated_at IS NULL;
