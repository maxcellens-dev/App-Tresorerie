-- ============================================================================
-- 220 — CLÔTURE : suppression de la pop-up de bilan « Félicitations ! ».
--
-- La fenêtre « Il te restait X € sur ton enveloppe le mois dernier » est retirée du code
-- (components/closure/ClosureBilanModal, supprimé). On purge ici la valeur qu'elle consommait.
--
-- POURQUOI PURGER, ET PAS SEULEMENT ARRÊTER D'ÉCRIRE : le drapeau « vu » n'était posé qu'à la
-- FERMETURE de la pop-up. Une pop-up jamais fermée — app tuée, écran quitté — laissait un bilan
-- `seen: false` qui revenait indéfiniment, en annonçant « le mois dernier » pour un mois qui ne
-- l'était plus depuis longtemps. Ces valeurs dorment dans les profils : sans ce UPDATE, elles
-- continueraient de faire apparaître la pop-up sur tout bundle pas encore mis à jour.
--
-- LA COLONNE N'EST PAS SUPPRIMÉE, volontairement. Un bundle antérieur encore déployé (le temps
-- d'une OTA) écrit encore `last_closure_bilan` dans le même UPDATE que `closure_lock_date` : la
-- retirer ferait échouer cet UPDATE, donc la clôture entière. Elle est simplement abandonnée —
-- plus personne ne la lit, et le reliquat reste enregistré là où il sert vraiment
-- (`month_closures.surplus`, repris dans l'export de données).
-- ============================================================================

UPDATE public.profiles
SET last_closure_bilan = NULL
WHERE last_closure_bilan IS NOT NULL;

COMMENT ON COLUMN public.profiles.last_closure_bilan IS
  'ABANDONNÉE (migration 220) — alimentait la pop-up de bilan de clôture, supprimée. Plus aucune '
  'lecture. Conservée le temps que les bundles antérieurs cessent de l''écrire ; supprimable ensuite.';
