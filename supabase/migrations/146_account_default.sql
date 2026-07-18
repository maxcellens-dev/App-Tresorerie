-- ============================================================================
-- 146 — COMPTE COURANT PAR DÉFAUT (un par utilisateur).
--
-- L'utilisateur peut désigner son compte courant principal : il est pré-sélectionné à la saisie
-- d'une transaction et apparaît en TÊTE de toutes les listes de comptes (cf. lib/accountOrder).
--
-- Contrainte : AU PLUS UN compte par défaut par profil (index unique partiel). Réservé aux comptes
-- COURANTS (checking) : un livret ou un PEA n'a pas de sens comme compte de saisie par défaut.
-- ============================================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Un seul compte par défaut par utilisateur (l'index partiel n'indexe que les lignes à true).
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_one_default_per_profile
  ON public.accounts(profile_id) WHERE is_default;

-- Garde-fou : seul un compte COURANT, ACTIF et NON JOINT peut être le compte par défaut
-- (le défaut sert à la saisie perso ; un compte joint a sa propre logique de sélection).
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_default_checking_only;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_default_checking_only
  CHECK (NOT is_default OR (type = 'checking' AND is_active AND NOT COALESCE(is_joint, false)));

-- Amorçage : pour chaque profil possédant au moins un compte courant perso actif et AUCUN défaut,
-- on désigne le plus ancien (comportement actuel de l'app = 1er compte courant perso). L'utilisateur
-- peut le changer à tout moment depuis la page Comptes.
WITH first_checking AS (
  SELECT DISTINCT ON (profile_id) id, profile_id
  FROM public.accounts
  WHERE type = 'checking' AND is_active AND NOT COALESCE(is_joint, false)
  ORDER BY profile_id, created_at
)
UPDATE public.accounts a
SET is_default = true
FROM first_checking f
WHERE a.id = f.id
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts d
    WHERE d.profile_id = a.profile_id AND d.is_default
  );

NOTIFY pgrst, 'reload schema';
