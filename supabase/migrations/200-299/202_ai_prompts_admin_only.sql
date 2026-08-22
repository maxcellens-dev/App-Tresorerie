-- ============================================================================
-- 202 — Conseils IA : fermer la lecture de `ai_prompts` aux non-admins.
--
-- ⛔ NE PAS JOUER TANT QUE DES CLIENTS ANTÉRIEURS SONT EN CIRCULATION.
--
-- Ce que fait cette migration : la table n'est plus lisible que par un admin. Les titres d'analyses
-- passent alors par `ai_analyses()` (migration 201), et l'Edge Function `ai-advice` lit les prompts
-- avec le service role (hors RLS) : elle n'est pas concernée.
--
-- Ce qui arrive à un ANCIEN client (celui qui fait encore `select * from ai_prompts`) : la lecture
-- ne renvoie pas d'erreur — la RLS filtre en silence, il reçoit ZÉRO ligne. Conséquence : la
-- section « Analyses » de la page Conseils Intelligents devient VIDE. Le chat, les questions
-- rapides, l'historique et tout le reste de l'app continuent de fonctionner normalement (aucune
-- autre page ne lit cette table) : ce n'est pas un blocage, c'est une fonctionnalité qui disparaît.
--
-- Pourquoi cette prudence : `runtimeVersion` est FIXE dans app.json, mais un appareil resté sur un
-- BUILD NATIF antérieur (runtime différent) ne reçoit PAS les mises à jour OTA — il garderait donc
-- l'ancien code jusqu'à une mise à jour depuis le store.
--
-- CONDITION pour jouer cette migration :
--   1. l'OTA contenant `useAiAnalyses` est en ligne ;
--   2. plus aucun appareil actif sur un runtime antérieur (sinon : accepter la perte des analyses
--      pour ces appareils jusqu'à leur mise à jour store).
--
-- Pour revenir en arrière :
--   DROP POLICY IF EXISTS ai_prompts_read ON public.ai_prompts;
--   CREATE POLICY ai_prompts_read ON public.ai_prompts FOR SELECT USING (auth.role() = 'authenticated');
-- ============================================================================

DROP POLICY IF EXISTS ai_prompts_read ON public.ai_prompts;
CREATE POLICY ai_prompts_read ON public.ai_prompts FOR SELECT USING (is_app_admin());

NOTIFY pgrst, 'reload schema';
