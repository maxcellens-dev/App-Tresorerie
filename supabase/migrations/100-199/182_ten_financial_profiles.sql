-- ============================================================================
-- 182 — DIX PROFILS FINANCIERS (P0 … P9) au lieu de cinq.
--
-- POURQUOI
-- ────────
-- Cinq paliers ne décrivaient correctement ni le bas ni le haut de l'échelle :
--   • aucun profil pour quelqu'un de STRUCTURELLEMENT déficitaire — il recevait les mêmes conseils
--     que quelqu'un qui commence tout juste à épargner ;
--   • un seul « P5 » couvrait de 20 000 € à plusieurs millions, avec les mêmes pourcentages ;
--   • trois paliers seulement pour tout le milieu, là où se trouve l'immense majorité des gens.
-- Et surtout : un compte NEUF, sans revenu constaté, tombait en « épargne critique » — un
-- diagnostic alarmant servi à quelqu'un dont on ne savait strictement rien. C'est ce que corrige
-- P0 « Découverte » : l'absence de donnée n'est pas une mauvaise nouvelle.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
--  1. élargit la contrainte de valeur sur user_financial_profile.profile_id ;
--  2. seed les paliers de transition et les messages des nouveaux passages.
--
-- CE QU'ELLE NE FAIT SURTOUT PAS : RENUMÉROTER LES PROFILS EXISTANTS
-- ──────────────────────────────────────────────────────────────────
-- Une première version remappait les valeurs en base (ancien P5 → nouveau P6, etc.) pour que
-- personne ne « descende » d'un cran au déploiement. C'était un piège : une migration s'applique à
-- la base AVANT que la nouvelle version du code n'atteigne les appareils. Entre les deux, un client
-- encore sur l'ancien bundle lit un `P6` qu'il ne connaît pas — et l'état des lieux plante
-- (`DEFAULT_PULSE_SIGNALS['P6']` vaut undefined), pour tous les utilisateurs à la fois.
--
-- Laisser les anciens codes tels quels est sans danger dans les deux sens : P1–P5 existent dans les
-- deux échelles, l'ancien bundle continue de fonctionner, et le nouveau RECALCULE de toute façon le
-- profil dès la première ouverture, à partir des données réelles (useLiveProfileSync). Le décalage
-- ne dure donc que le temps du premier lancement, sans le moindre écran cassé.
--
-- Le code, lui, ne suppose plus qu'un identifiant lu en base fait partie du référentiel
-- (cf. `resolveProfileId` dans lib/finance/financialProfileEngine) : une valeur inconnue est
-- ramenée sur l'échelle au lieu de faire tomber l'écran.
--
-- ⚠️ Les POURCENTAGES de répartition ne vivent PAS en base : ils sont dans
-- lib/finance/financialProfileEngine (PROFILE_ALLOCATIONS), profil par profil. La table
-- `recommendation_tier_allocations` garde ses cinq paliers, qui ne servent plus qu'au VOCABULAIRE
-- des recommandations (cf. PROFILE_TO_TIER).
-- ============================================================================

-- ── 1) Nouvelles valeurs autorisées ─────────────────────────────────────────────────────────
ALTER TABLE public.user_financial_profile DROP CONSTRAINT IF EXISTS user_financial_profile_profile_id_check;
ALTER TABLE public.user_financial_profile
  ADD CONSTRAINT user_financial_profile_profile_id_check
  CHECK (profile_id IN ('P0','P1','P2','P3','P4','P5','P6','P7','P8','P9'));

-- ── 2) Paliers de transition ────────────────────────────────────────────────────────────────
-- Les seuils suivent la même progression que les cinq d'origine (mois de sécurité × taux
-- d'épargne), étalés sur huit passages au lieu de quatre. Les nouveaux paliers hauts se
-- déclenchent surtout sur le patrimoine, mesuré côté client : ici on garde des seuils de flux
-- cohérents, qui ne bloquent pas une montée légitime.
INSERT INTO profile_matrix_config (
  transition,
  upgrade_months_threshold, upgrade_flux_threshold,
  downgrade_months_threshold, downgrade_flux_threshold,
  anti_yoyo_months
) VALUES
  ('P1_P2',  0.5,  0,   0,    0, 1),   -- sortir du rouge : repasser au-dessus de zéro suffit
  ('P2_P3',  1,    5,   0.5,  0, 1),
  ('P3_P4',  3,   10,   1,    5, 1),
  ('P4_P5',  6,   12,   2.5,  5, 1),
  ('P5_P6',  6,   15,   5,    8, 1),   -- passage à l'investissement
  ('P6_P7',  6,   18,   5,   10, 1),
  ('P7_P8',  6,   20,   5,   10, 1),
  ('P8_P9',  6,   20,   5,   10, 1)
ON CONFLICT (transition) DO NOTHING;

-- ── 3) Messages des nouveaux passages ───────────────────────────────────────────────────────
-- Tutoiement (cf. migration 145) et titres courts (cf. 159) : mêmes conventions que l'existant.
INSERT INTO profile_notification_messages (transition, direction, title, body) VALUES
  ('P1_P2', 'upgrade',
   '🌱 Tu repasses au-dessus de zéro',
   'Tes mois ne se terminent plus dans le rouge. C''est la marche la plus difficile, et tu viens de la passer. La suite est plus simple : mettre de côté un premier mois de revenu, pour ne plus jamais y retourner.'),

  ('P2_P3', 'upgrade',
   '🌿 Ton filet de sécurité existe',
   'Tu as désormais plus d''un mois de revenu de côté. Un imprévu ne fait plus basculer ton mois. L''objectif du moment : monter jusqu''à trois mois, le seuil à partir duquel on respire vraiment.'),

  ('P3_P4', 'upgrade',
   '⚖️ Tu as trouvé ton équilibre',
   'Trois mois de réserve et une épargne régulière : ta situation est stable. Ce que tu mets de côté au-delà peut commencer à travailler plutôt que de dormir.'),

  ('P4_P5', 'upgrade',
   '🛡️ Ta sécurité est acquise',
   'Plus de six mois de revenus disponibles : ton matelas est fait. Continuer à empiler du liquide ne t''apporte plus grand-chose — c''est le bon moment pour envisager autre chose.'),

  ('P5_P6', 'upgrade',
   '🌍 Tes premiers placements sont en place',
   'Réserve solide et argent réellement investi : tu es passé de l''épargne à l''investissement. Ce qui compte maintenant n''est plus le montant mais la régularité de tes versements.'),

  ('P6_P7', 'upgrade',
   '🚀 Ton patrimoine se construit',
   'Le total de tes comptes dépasse 30 000 €. Ton épargne de précaution est pleine : la part investie prend logiquement le dessus dans nos recommandations.'),

  ('P7_P8', 'upgrade',
   '🏛️ Ton patrimoine est établi',
   'Au-delà de 100 000 € sur tes comptes, tu rejoins une minorité. L''enjeu n''est plus d''accumuler mais de faire fructifier ce qui est déjà là.'),

  ('P8_P9', 'upgrade',
   '💎 Un patrimoine d''exception',
   'Plus de 300 000 € sur tes comptes bancaires — et si tu franchis le million, tu appartiens à une fraction de pour cent des ménages. À ce niveau, chaque euro qui dort a un coût.'),

  ('P1_P2', 'downgrade',
   '🌧️ Ton mois se termine dans le rouge',
   'Tes comptes courants finissent en négatif. Rien n''est perdu, mais tout le reste attend : l''app met de côté les conseils d''épargne et d''investissement le temps que tu repasses au-dessus de zéro.'),

  ('P2_P3', 'downgrade',
   '🌱 Ta réserve est repassée sous un mois',
   'Ton matelas est descendu en dessous d''un mois de revenu. L''objectif redevient simple et unique : le reconstituer, avant toute autre décision.'),

  ('P3_P4', 'downgrade',
   '🌿 Ta réserve est passée sous trois mois',
   'Ta réserve de sécurité a baissé. Tes recommandations s''ajustent pour la reconstituer en priorité. Dès qu''elle remonte, tu retrouves ton niveau précédent.'),

  ('P4_P5', 'downgrade',
   '⚖️ Ta réserve est passée sous six mois',
   'Ton matelas s''est réduit. Rien d''alarmant : on remet un peu plus de poids sur l''épargne, le temps qu''il retrouve son niveau.'),

  ('P5_P6', 'downgrade',
   '🛡️ Retour à la consolidation',
   'Ton flux d''investissement ou ta réserve a baissé. On resserre temporairement sur la sécurité — c''est la base sur laquelle tout le reste tient.'),

  ('P6_P7', 'downgrade',
   '🌍 Ton patrimoine est repassé sous le palier',
   'Le total de tes comptes est redescendu. Tes recommandations reviennent à un équilibre plus prudent entre épargne et investissement.'),

  ('P7_P8', 'downgrade',
   '🚀 Ton patrimoine est repassé sous 100 000 €',
   'Le total de tes comptes a baissé. Les recommandations s''ajustent en conséquence, sans rien changer à ta stratégie de fond.'),

  ('P8_P9', 'downgrade',
   '🏛️ Ton patrimoine est repassé sous 300 000 €',
   'Le total de tes comptes a baissé. Tes recommandations reviennent au palier précédent.')

ON CONFLICT (transition, direction) DO NOTHING;

-- Messages de MAINTIEN (bilan mensuel sans changement de profil) pour les nouveaux paliers.
-- Convention (migration 079) : `transition` = l'identifiant du profil lui-même.
INSERT INTO profile_notification_messages (transition, direction, title, body) VALUES
  ('P0', 'upgrade',
   '🧭 On apprend à te connaître',
   'Ton profil se calcule tout seul, à partir de tes comptes et de tes rentrées d''argent — aucun questionnaire à remplir. Ajoute ce qui manque, et il apparaîtra.'),
  ('P6', 'upgrade',
   '🌍 Tu tiens le cap',
   'Réserve solide et placements en route : la situation est stable. La régularité fait le reste.'),
  ('P7', 'upgrade',
   '🚀 Ton patrimoine continue de croître',
   'Rien à corriger ce mois-ci : ta trajectoire est bonne. Continue.'),
  ('P8', 'upgrade',
   '🏛️ Patrimoine stable',
   'Ta situation ne bouge pas, et c''est très bien ainsi. L''enjeu reste de faire travailler ce qui dort.'),
  ('P9', 'upgrade',
   '💎 Situation maintenue',
   'À ton niveau, l''essentiel est que le liquide immobilisé reste sous contrôle. C''est le cas ce mois-ci.')
ON CONFLICT (transition, direction) DO NOTHING;

NOTIFY pgrst, 'reload schema';
