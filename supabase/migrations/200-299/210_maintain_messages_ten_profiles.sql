-- ============================================================================
-- 210 — LE BILAN MENSUEL CESSE D'ANNONCER UN CHANGEMENT QUI N'A PAS EU LIEU.
--
-- CE QUI SE PASSAIT
-- ─────────────────
-- Une fois par mois, l'app pose un « bilan » : une ligne de journal où le profil de départ et le
-- profil d'arrivée sont IDENTIQUES (direction « same »), qui ouvre une fenêtre pour dire à
-- l'utilisateur que sa situation est stable.
--
-- Les libellés de ce bilan n'existent que pour P1 à P5. L'échelle est passée à DIX paliers
-- (migration 182) sans que ces messages suivent. Résultat, tous les mois, pour tout utilisateur
-- classé P0 ou P6 à P9 :
--
--     titre  : « Ton profil a changé »   ← alors que, par définition, il n'a pas changé
--     corps  : (vide)                    ← aucune ligne en base, aucun repli dans le code
--
-- Le code porte désormais un repli (cf. components/ui/ProfileChangeModal) : plus personne ne peut
-- voir une fenêtre vide. Mais un repli générique reste un repli — les cinq paliers qui manquent
-- méritent leur propre phrase, comme les cinq autres.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- Elle complète la série, dans la même voix que l'existant : un constat de stabilité, puis le geste
-- qui correspond au palier. Rien d'alarmiste — c'est un rendez-vous, pas une alerte.
--
-- P0 (« Découverte ») en fait partie : c'est le seul cas où le bilan a quelque chose d'utile à dire,
-- puisqu'il signale ce qui manque encore pour être classé.
--
-- Rejouable : `ON CONFLICT DO NOTHING` — les libellés déjà réglés en administration ne sont jamais
-- écrasés.
-- ============================================================================

INSERT INTO public.profile_notification_messages (transition, direction, title, body) VALUES
  ('P0', 'same',
   '🧭 Ton profil se cherche encore',
   'Relyka n''a pas encore de quoi te classer. Ajoute tes comptes et tes rentrées d''argent récurrentes : ton profil apparaîtra tout seul.'),
  ('P6', 'same',
   '🌍 Tu conserves ton profil',
   'Ta situation reste stable ce mois-ci. Réserve solide et placements en route : l''enjeu est la régularité, pas le montant.'),
  ('P7', 'same',
   '🚀 Tu conserves ton profil',
   'Ton profil reste stable ce mois-ci. Ton patrimoine se construit : continue à faire travailler ce qui dépasse ta réserve.'),
  ('P8', 'same',
   '🏛️ Tu conserves ton profil',
   'Ta situation reste stable ce mois-ci. L''enjeu n''est plus d''accumuler mais de diversifier ce qui est déjà là.'),
  ('P9', 'same',
   '💎 Tu conserves ton profil',
   'Ton profil reste stable ce mois-ci. À ce niveau, chaque euro qui dort a un coût : surveille ce qui reste en liquide.')
ON CONFLICT (transition, direction) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT transition FROM profile_notification_messages WHERE direction = 'same' ORDER BY transition;
--   -- doit rendre P0 puis P1 … P9 : dix paliers, dix messages de maintien.
