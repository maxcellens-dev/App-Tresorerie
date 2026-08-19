-- ============================================================================
-- 186 — Le MATELAS DE SÉCURITÉ se compte en mois de DÉPENSES : les textes en base suivent.
--
-- Le calcul est passé de « épargne ÷ revenu » à « épargne ÷ dépenses essentielles » (charges
-- récurrentes + budget variable) — cf. lib/securityCushion. Ce qu'il faut couvrir quand les
-- rentrées s'arrêtent, c'est ce qu'on DÉPENSE pour vivre, pas ce qu'on gagnait.
--
-- Restaient deux endroits où l'ancienne formulation vit EN BASE, donc hors de portée du code :
--   • les conseils du Pilotage (table `conseils`, migration 060) ;
--   • les messages de changement de profil (table `profile_notification_messages`).
-- Un utilisateur y lisait « X mois de revenus » pendant que tout le reste de l'app lui parlait de
-- mois de dépenses — avec un chiffre différent, puisque la base de calcul n'est plus la même. Deux
-- réponses à la même question, dans la même application.
-- ============================================================================

UPDATE public.conseils
SET message = '{savings_months} mois de dépenses en réserve. La question n''est plus vraiment d''épargner plus — c''est de décider quoi faire avec ce que tu as déjà.'
WHERE message LIKE '%mois de revenus en réserve%';

UPDATE public.conseils
SET message = 'Ta réserve couvre moins de 2 mois de dépenses. En cas d''imprévu, tu serais rapidement en difficulté.'
WHERE message LIKE '%moins de 2 mois de revenus%';

UPDATE public.profile_notification_messages
SET body = 'Plus de six mois de dépenses couverts par ton épargne : ton matelas est fait. Continuer à empiler du liquide ne t''apporte plus grand-chose — c''est le bon moment pour envisager autre chose.'
WHERE transition = 'P4_P5' AND direction = 'upgrade'
  AND body LIKE '%mois de revenus disponibles%';

-- Repli générique : toute autre formulation en « mois de revenus » dans les messages de profil.
UPDATE public.profile_notification_messages
SET body = replace(body, 'mois de revenus', 'mois de dépenses')
WHERE body LIKE '%mois de revenus%';

UPDATE public.conseils
SET message = replace(message, 'mois de revenus', 'mois de dépenses')
WHERE message LIKE '%mois de revenus%';

NOTIFY pgrst, 'reload schema';
