-- ============================================================================
-- 154 — Conseils IA : sections détaillées balisées « ### » (regroupement DÉTERMINISTE en cartes).
--
-- Problème : l'app découpait l'analyse détaillée en cartes sur une heuristique « emoji + **gras** »,
-- mais le modèle met des emojis PARTOUT (👉 **L'ACTION :**, 💡 **POURQUOI :**, 🎯 sous-titres…) →
-- chaque sous-point devenait une carte (rendu « brouillon », cf. retours utilisateur).
--
-- Solution : contrat EXPLICITE — chaque SECTION de l'analyse détaillée commence par « ### emoji Titre ».
-- Le parseur (lib/aiReport) : s'il voit au moins un « ### », il ne découpe QUE sur ces lignes ;
-- tout le reste (gras, emojis, puces, sous-labels) reste DANS la carte de sa section.
-- Repli heuristique conservé pour les anciens messages sans « ### ».
--
-- Idempotent : guard « SECTIONS EN ### ».
-- ============================================================================

UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $h$SECTIONS EN ### (OBLIGATOIRE — l'app en fait des cartes) : après le bloc ##RELYKA, chaque SECTION de ton analyse détaillée commence par une ligne « ### <emoji> <Titre court> » (trois dièses). Exemple : « ### 💸 À optimiser ». À L'INTÉRIEUR d'une section, utilise uniquement des puces « - » et du **gras** pour les sous-titres (ex. « **L'action :** ») — JAMAIS de ligne commençant par un emoji seul ni de nouveau « ### » pour un sous-point. Une action numérotée (1., 2., 3.) et ses détails (action/pourquoi/gain) restent DANS la même section.$h$
WHERE key IN ('analysis_expenses', 'analysis_global', 'analysis_reco', 'chat_system')
  AND prompt_template NOT LIKE '%SECTIONS EN ###%';

NOTIFY pgrst, 'reload schema';
