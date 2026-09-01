-- ============================================================================
-- 221 — MESSAGES DE PROFIL : un VRAI retour à la ligne dans les bilans de maintien.
--
-- LE PIÈGE
-- ────────
-- Écrire 'Ta situation reste stable. \nRéserve solide…' dans une chaîne SQL ORDINAIRE ne pose
-- AUCUN saut de ligne : avec `standard_conforming_strings = on` (le défaut), Postgres stocke les
-- deux caractères `\` et `n` tels quels. L'app les affichait donc littéralement, en plein milieu
-- de la phrase. Il faut une chaîne d'échappement — E'…\n…' — ou `chr(10)`.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- 1. Elle RÉPARE les « \n » littéraux déjà stockés, quelle que soit la ligne.
-- 2. Elle détache la première phrase des messages de MAINTIEN (direction 'same') : ces messages
--    disent un constat, puis le geste qui va avec — deux temps, donc deux lignes.
--
-- Pourquoi une règle et pas dix réécritures : le libellé de chaque palier est modifiable en
-- administration. Chercher un texte exact n'aurait rien fait sur une ligne retouchée, et aurait
-- écrasé le travail de l'admin si on avait forcé. On applique donc la MISE EN FORME, sans toucher
-- aux mots.
--
-- Rejouable : la garde `position(chr(10) IN body) = 0` saute tout message déjà sur deux lignes —
-- sans elle, chaque exécution ajouterait une coupure de plus.
-- ============================================================================

-- 1. Réparation des « \n » littéraux (deux caractères) → vrai saut de ligne.
--    ⚠️ `strpos` et non `LIKE` : dans un motif LIKE, l'antislash est le caractère d'échappement,
--    donc '%\n%' y signifie « contient la lettre n » — ça aurait touché presque toutes les lignes.
UPDATE public.profile_notification_messages
SET body = replace(body, '\n', chr(10)),
    updated_at = now()
WHERE strpos(body, '\n') > 0;

-- 2. Bilans de MAINTIEN : le constat sur une ligne, le geste sur la suivante.
--    `regexp_replace` sans le drapeau 'g' ne remplace que la PREMIÈRE occurrence — c'est
--    exactement ce qu'on veut : une seule coupure, après la première phrase.
UPDATE public.profile_notification_messages
SET body = regexp_replace(body, '\. ', E'.\n'),
    updated_at = now()
WHERE direction = 'same'
  AND position(chr(10) IN body) = 0   -- pas déjà sur deux lignes (rejouable)
  AND body ~ '\. ';                   -- il y a bien une phrase à détacher

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT transition, body FROM profile_notification_messages
--    WHERE direction = 'same' ORDER BY transition;
--   -- chaque corps doit contenir un saut de ligne RÉEL, et plus aucun « \n » visible.
