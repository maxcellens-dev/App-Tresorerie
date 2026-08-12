-- ============================================================================
-- 166 — Crédit « partagé » : la RESPONSABILITÉ, pas l'accès.
--
-- Jusqu'ici, « crédit partagé » ne voulait dire qu'une chose : quelqu'un d'autre y a accès
-- (`credit_members`, rôle consultation/écriture). Ce sont pourtant deux questions distinctes :
--
--   • QUI PORTE LA DETTE ?  → un crédit souscrit à deux (couple, SCI, associés) reste partagé même
--     si personne d'autre ne l'a ouvert dans l'app ;
--   • QUI PEUT LE VOIR ?    → un accès en consultation donné à un tiers ne rend pas la dette commune.
--
-- Confondre les deux fausse tout regroupement : le récap de l'onglet Crédits doit séparer « ce que
-- je dois seul » de « ce que nous devons », pas « ce que j'ai partagé à l'écran ».
--
-- Défaut `false` : tous les crédits existants restent PERSO. Personne ne voit ses totaux changer
-- sans l'avoir décidé — le drapeau se pose à la main, crédit par crédit.
-- ============================================================================

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.credits.is_shared IS
  'Responsabilité PARTAGÉE de la dette (souscrit à plusieurs). Indépendant de credit_members, '
  'qui ne gouverne que le DROIT D''ACCÈS (consultation / écriture). Sert au regroupement '
  'perso / partagé du récap de l''onglet Crédits.';

-- Aucune policy à ajouter : la colonne suit les policies existantes de `credits`
-- (le propriétaire écrit, les membres lisent selon leur rôle).
