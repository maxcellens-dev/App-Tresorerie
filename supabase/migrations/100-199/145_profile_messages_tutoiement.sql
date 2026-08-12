-- ============================================================================
-- 145 — Messages de changement de profil : TUTOIEMENT (l'app tutoie partout).
--
-- Réécrit TOUS les messages stockés (montées, descentes, exceptionnels) en tutoiement, et seed
-- les messages de MAINTIEN (bilan mensuel, direction 'same') qui n'existaient qu'en repli code.
--
-- Corrige aussi un BUG de clés : les DESCENTES étaient stockées sous 'P2_P1', 'P3_P2'… alors que
-- le modal (ProfileChangeModal.getTransitionKey) cherche 'P1_P2'|downgrade, 'P2_P3'|downgrade…
-- → les messages de descente édités en admin n'étaient JAMAIS affichés (repli code utilisé).
-- On normalise sur la convention du modal : transition = 'P<bas>_P<haut>', la direction distingue.
-- ============================================================================

-- 1) Purge des anciennes clés de descente (jamais lues par le modal).
DELETE FROM public.profile_notification_messages
WHERE direction = 'downgrade' AND transition IN ('P2_P1', 'P3_P2', 'P4_P3', 'P5_P4');

-- 2) Tous les messages, en tutoiement (écrase l'existant : demande produit).
INSERT INTO public.profile_notification_messages (transition, direction, title, body) VALUES
  -- ── Montées ──
  ('P1_P2', 'upgrade',
   '🌿 Tu passes au profil "Réserve à construire"',
   'Ton matelas de sécurité commence à se constituer. C''est une vraie avancée — tu as maintenant un filet de protection en cas d''imprévu. L''objectif du moment : continuer sur cette lancée et atteindre 3 mois de réserve.'),
  ('P2_P3', 'upgrade',
   '⚖️ Tu passes au profil "Stabilité à améliorer"',
   'Ta base financière est solide. Tu as constitué une réserve de sécurité réelle et ton comportement d''épargne est régulier. Il est maintenant temps de commencer à faire travailler ton argent au-delà de l''épargne pure.'),
  ('P3_P4', 'upgrade',
   '🚀 Tu passes au profil "Bonne dynamique"',
   'Excellent travail. Ta réserve de sécurité est confortable et tu épargnes ou investis régulièrement. Tu entres dans une phase où l''investissement prend une place plus importante pour faire croître ton patrimoine.'),
  ('P4_P5', 'upgrade',
   '🎯 Tu passes au profil "Patrimoine en développement"',
   'Tu as atteint un niveau de maturité financière remarquable. Ta réserve de sécurité est très solide et tu investis de manière significative. La priorité est maintenant d''optimiser et de faire croître ton patrimoine.'),

  -- ── Descentes (clés normalisées : P<bas>_P<haut>) ──
  ('P1_P2', 'downgrade',
   '🌱 Ton profil évolue vers "Premiers repères"',
   'Ta réserve de sécurité s''est réduite ou ton épargne est à l''arrêt depuis quelques mois. Pas d''inquiétude — l''application adapte ses recommandations pour t''aider à reconstruire une base stable en priorité.'),
  ('P2_P3', 'downgrade',
   '🌿 Ton profil évolue vers "Réserve à construire"',
   'Ta situation financière a évolué ces dernières semaines. Ta réserve de sécurité est en dessous du seuil recommandé. L''objectif du moment est de la reconstituer avant de reprendre une stratégie d''investissement.'),
  ('P3_P4', 'downgrade',
   '⚖️ Ton profil évolue vers "Stabilité à améliorer"',
   'Ta réserve de sécurité ou ton niveau d''épargne a baissé. Ton profil s''ajuste temporairement pour sécuriser ta situation. Dès que ta réserve remonte, tu retrouveras ton niveau précédent.'),
  ('P4_P5', 'downgrade',
   '🚀 Ton profil évolue vers "Bonne dynamique"',
   'Ta réserve ou ton flux d''investissement est passé en dessous du seuil du profil précédent. Tes recommandations s''adaptent en conséquence. Rien d''alarmant — une légère réorientation suffit pour retrouver ton niveau.'),

  -- ── Exceptionnels (chute de revenus) ──
  ('exceptional_one', 'exceptional',
   '⚠️ Ton profil a été ajusté suite à une baisse de revenus',
   'Tes revenus des 2 derniers mois sont nettement inférieurs à ta moyenne habituelle. Ton profil a été ajusté d''un niveau pour adapter les recommandations à ta situation actuelle. L''application passe en mode « protection » le temps que ta situation se stabilise.'),
  ('exceptional_two', 'exceptional',
   '⚠️ Ton profil a été ajusté — aucun revenu détecté',
   'Aucun revenu n''a été enregistré ces 2 derniers mois. Ton profil a été ajusté de deux niveaux pour te proposer des recommandations adaptées à cette période. L''objectif est de préserver ton épargne disponible au maximum.'),

  -- ── Maintien (bilan mensuel, un par profil — enfin éditables en admin) ──
  ('P1', 'same',
   '🌱 Toujours au profil "Premiers repères"',
   'Ce mois-ci, ton profil reste inchangé. Continue à constituer ton matelas de sécurité.'),
  ('P2', 'same',
   '🌿 Toujours au profil "Réserve à construire"',
   'Ton profil reste stable ce mois-ci. Poursuis le renforcement de ta réserve.'),
  ('P3', 'same',
   '⚖️ Toujours au profil "Stabilité à améliorer"',
   'Ta situation reste stable ce mois-ci. Continue sur cette lancée.'),
  ('P4', 'same',
   '🚀 Toujours au profil "Bonne dynamique"',
   'Ton profil reste solide ce mois-ci. Ta dynamique d''investissement se confirme.'),
  ('P5', 'same',
   '🎯 Toujours au profil "Patrimoine en développement"',
   'Ta maturité financière se maintient ce mois-ci. Continue à optimiser ton patrimoine.')

ON CONFLICT (transition, direction) DO UPDATE
SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = now();
