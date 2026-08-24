-- ============================================================================
-- 206 — L'ÉCHELLE DES PROFILS, VERSION 2 : quatre questions, dans l'ordre.
--
-- CE QUI CHANGE DANS LE CLASSEMENT
-- ────────────────────────────────
--   1. la situation est-elle VIABLE ?        revenu vs dépenses essentielles      → sinon P1
--   2. combien de temps tient-il ?           épargne ÷ dépenses essentielles      → P2 … P5
--   3. investit-il RÉELLEMENT ?              oui / non                            → P6
--   4. quelle taille fait le patrimoine ?    30k / 100k / 300k                    → P7 … P9
--
-- LE TAUX D'ÉPARGNE DISPARAÎT DU CLASSEMENT, et c'est un correctif.
-- Il mesurait un MÉRITE là où le profil décrit un ÉTAT : la règle « 1 mois de réserve + 20 % mis de
-- côté → P4 » mettait dans le même palier quelqu'un avec cinq mois d'avance et quelqu'un avec un
-- seul — deux situations sans rapport, un seul conseil. Il était en outre mesuré sur les seuls
-- VIREMENTS sortants vers un compte d'épargne : qui épargne autrement (apport saisi à la main,
-- compte hors app, virement fait à la banque) lisait 0 %. Ce n'était pas un signal, c'était un
-- artefact de saisie.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT : cette migration AVANT l'OTA. Le client écrit `ladder_version` et lit
-- les nouvelles colonnes de viabilité ; sans elles, la réévaluation échoue en 400. L'inverse est
-- sans danger : un client encore sur l'ancien bundle ignore simplement les nouvelles colonnes.
-- ============================================================================

-- ── 1) RECLASSEMENT SILENCIEUX ───────────────────────────────────────────────────────────────
-- Changer les règles reclasse toute la base à la première ouverture. Chaque changement écrit une
-- ligne dans `profile_change_log` avec `notification_shown = false` → une fenêtre « ton profil a
-- changé » pour CHAQUE utilisateur, le même jour, pour un changement que personne n'a provoqué.
-- Le client compare cette colonne à sa constante `PROFILE_LADDER_VERSION` : tant qu'elle est en
-- retard, la réévaluation qui suit écrit le nouveau palier et le journalise, mais marque la
-- notification comme déjà vue. L'utilisateur retrouve simplement son profil à jour.
ALTER TABLE public.user_financial_profile
  ADD COLUMN IF NOT EXISTS ladder_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_financial_profile.ladder_version IS
  'Version des RÈGLES de classement ayant produit ce profil (cf. PROFILE_LADDER_VERSION côté client). En retard ⇒ la prochaine réévaluation reclasse en silence.';

-- Les lignes existantes restent à 0 : c''est précisément ce qui déclenche leur reclassement muet.

-- ── 2) VIABILITÉ : la bande qui manquait ─────────────────────────────────────────────────────
-- L'entrée et la sortie de P1 se décidaient sur une comparaison STRICTE (charges > revenu), sans
-- hystérésis — alors que tout le reste de l'échelle en a une. Un revenu qui oscille de 3 % autour
-- de ses charges faisait donc basculer P1 ⇄ P2 à chaque saisie, sur le palier le plus lourd à
-- recevoir. Trois réglages, portés par la ligne P1_P2 :
--   • sortie  : les charges doivent descendre sous 95 % du revenu pour être déclaré viable ;
--   • entrée  : elles doivent dépasser 102 % pour tomber en P1 ;
--   • grâce   : au-delà de 6 mois de réserve, la non-viabilité ne suffit plus à classer « Fragile ».
--     Consommer volontairement deux ans d'épargne (sabbatique, transition, création d'entreprise,
--     retraite anticipée) n'est pas une fragilité — sans cette dispense, l'app servirait son
--     diagnostic le plus dur à des gens qui maîtrisent parfaitement leur trajectoire.
ALTER TABLE public.profile_matrix_config
  ADD COLUMN IF NOT EXISTS viability_exit_ratio   numeric,
  ADD COLUMN IF NOT EXISTS viability_enter_ratio  numeric,
  ADD COLUMN IF NOT EXISTS viability_grace_months numeric;

COMMENT ON COLUMN public.profile_matrix_config.viability_exit_ratio IS
  'Part du revenu sous laquelle les charges doivent descendre pour QUITTER P1 (0,95 = 95 %). Ligne P1_P2 uniquement.';
COMMENT ON COLUMN public.profile_matrix_config.viability_enter_ratio IS
  'Part du revenu que les charges doivent dépasser pour TOMBER en P1 (1,02 = 102 %). Ligne P1_P2 uniquement.';
COMMENT ON COLUMN public.profile_matrix_config.viability_grace_months IS
  'Réserve (en mois de dépenses) au-delà de laquelle la non-viabilité ne classe plus en P1. Ligne P1_P2 uniquement.';

UPDATE public.profile_matrix_config
   SET viability_exit_ratio = 0.95, viability_enter_ratio = 1.02, viability_grace_months = 6
 WHERE transition = 'P1_P2';

-- ── 3) PALIERS DE PATRIMOINE : réserve alignée à 6 mois ──────────────────────────────────────
-- P7 exigeait TROIS mois de réserve quand P5 et P6 en demandent six : un palier « supérieur » était
-- donc moins exigeant que les deux qu'il surplombe. On pouvait monter en P7 en sautant P5 et P6,
-- puis retomber en P3 sans qu'aucune donnée n'ait bougé — et le décompte de paliers franchis
-- annonçait des sauts qui ne voulaient rien dire.
-- Alignés, les dix paliers forment une chaîne strictement cumulative : chaque palier AJOUTE une
-- condition à celui d'en dessous.
UPDATE public.profile_matrix_config SET upgrade_months_threshold = 6 WHERE transition = 'P6_P7';

-- ── 4) « VIDE » DOIT ÊTRE UNE VALEUR POSSIBLE ────────────────────────────────────────────────
-- Les quatre colonnes de seuils sont NOT NULL depuis la migration 020. Or le contrat du moteur est
-- désormais : « champ vide ⇒ le code applique son repli » (cf. `thresholdsFromMatrix`, qui retombe
-- champ par champ). L'écran d'administration écrit donc NULL quand une case est laissée vide —
-- impossible tant que la contrainte tient, et un zéro à la place serait pire qu'une case vide : ce
-- serait un seuil atteint par tout le monde.
ALTER TABLE public.profile_matrix_config
  ALTER COLUMN upgrade_months_threshold   DROP NOT NULL,
  ALTER COLUMN downgrade_months_threshold DROP NOT NULL,
  ALTER COLUMN upgrade_flux_threshold     DROP NOT NULL,
  ALTER COLUMN downgrade_flux_threshold   DROP NOT NULL;

-- ── 5) LES SEUILS DE FLUX NE GOUVERNENT PLUS RIEN ────────────────────────────────────────────
-- `upgrade_flux_threshold` / `downgrade_flux_threshold` portaient le taux d'épargne. Plus aucun
-- moteur ne les lit. On les VIDE plutôt que de les laisser peuplés : une valeur qui ressemble à un
-- réglage actif est pire qu'une case vide — c'est exactement le piège que dénonçait la migration
-- 194 (« un réglage sans effet est pire qu'un réglage absent »). L'écran d'administration ne les
-- affiche plus.
-- Les colonnes elles-mêmes sont CONSERVÉES : les supprimer casserait tout client encore sur
-- l'ancien bundle, qui les lit au chargement de l'écran d'administration.
UPDATE public.profile_matrix_config
   SET upgrade_flux_threshold = NULL, downgrade_flux_threshold = NULL
 WHERE upgrade_flux_threshold IS NOT NULL OR downgrade_flux_threshold IS NOT NULL;

COMMENT ON COLUMN public.profile_matrix_config.upgrade_flux_threshold IS
  'OBSOLÈTE (échelle v2) : le taux d''épargne ne classe plus. Conservée pour compatibilité, plus jamais lue.';
COMMENT ON COLUMN public.profile_matrix_config.downgrade_flux_threshold IS
  'OBSOLÈTE (échelle v2) : le taux d''épargne ne classe plus. Conservée pour compatibilité, plus jamais lue.';
COMMENT ON COLUMN public.profile_matrix_config.anti_yoyo_months IS
  'OBSOLÈTE : le clignotement est traité par l''hystérésis (deux seuils par palier), pas par un compteur de mois consécutifs.';

-- ── 6) LES MESSAGES PARLAIENT DE MOIS DE REVENU ──────────────────────────────────────────────
-- Le matelas se mesure en mois de DÉPENSES depuis longtemps ; les libellés semés en migration 182
-- disaient encore « un mois de revenu de côté ». L'utilisateur lisait donc une unité, et voyait un
-- chiffre calculé dans une autre.
UPDATE public.profile_notification_messages
   SET body = 'Tes mois ne se terminent plus dans le rouge. C''est la marche la plus difficile, et tu viens de la passer. La suite est plus simple : mettre de côté un premier mois de dépenses, pour ne plus jamais y retourner.'
 WHERE transition = 'P1_P2' AND direction = 'upgrade';

UPDATE public.profile_notification_messages
   SET body = 'Tu as désormais plus d''un mois de dépenses de côté. Un imprévu ne fait plus basculer ton mois. L''objectif du moment : monter jusqu''à trois mois, le seuil à partir duquel on respire vraiment.'
 WHERE transition = 'P2_P3' AND direction = 'upgrade';

UPDATE public.profile_notification_messages
   SET body = 'Plus de six mois de dépenses couverts : ton matelas est fait. Continuer à empiler du liquide ne t''apporte plus grand-chose — c''est le bon moment pour envisager autre chose.'
 WHERE transition = 'P4_P5' AND direction = 'upgrade';

UPDATE public.profile_notification_messages
   SET body = 'Ton matelas est descendu en dessous d''un mois de dépenses. L''objectif redevient simple et unique : le reconstituer, avant toute autre décision.'
 WHERE transition = 'P2_P3' AND direction = 'downgrade';

-- Le message de maintien de P0 rassurait sur une contrainte qui n'existe pas (« aucun questionnaire
-- à remplir ») : l'utilisateur n'a aucune raison d'y penser, et le lui dire l'y fait penser. On
-- garde le geste qui manque, on retire la réponse à une question qu'il ne se pose pas.
UPDATE public.profile_notification_messages
   SET body = 'Ton profil se calcule tout seul, à partir de tes comptes et de tes rentrées d''argent. Ajoute ce qui manque, et il apparaîtra.'
 WHERE transition = 'P0' AND direction = 'upgrade';

-- P1 s'appelle désormais « Fragile » : le titre de sa transition descendante disait « ton mois se
-- termine dans le rouge », ce qui décrit un découvert. Or P1 se déclenche sur une équation qui ne
-- boucle pas — avec ou sans découvert.
UPDATE public.profile_notification_messages
   SET title = '🌧️ Tes charges dépassent tes revenus',
       body  = 'Ce qui sort dépasse ce qui rentre : le mois ne peut pas se boucler tout seul. Rien n''est perdu, mais tout le reste attend — l''app met de côté les conseils d''épargne et d''investissement le temps de remettre l''équation à l''endroit.'
 WHERE transition = 'P1_P2' AND direction = 'downgrade';

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT transition, upgrade_months_threshold, downgrade_months_threshold,
--          upgrade_wealth_threshold, viability_exit_ratio, viability_enter_ratio,
--          viability_grace_months, upgrade_flux_threshold
--     FROM profile_matrix_config ORDER BY transition;
--   -- flux à NULL partout, P6_P7 à 6 mois, P1_P2 porteur des trois réglages de viabilité.
--
--   SELECT ladder_version, count(*) FROM user_financial_profile GROUP BY 1;
--   -- 0 partout au départ ; passe à 2 au fil des ouvertures, sans notification.
