-- ============================================================================
-- 149 — Conseils IA : SYNTHÈSE EN TÊTE (rendu en cartes par l'app), SANS rien retirer au fond.
--
-- L'app rend désormais les réponses en cartes (cf. lib/aiReport + components/AiReport) :
--   • un bloc de synthèse ##RELYKA … ##END en tête → carte Verdict (+ score) / Radar / Actions ;
--   • les sections riches habituelles (**🎯 …**) → cartes de section (corps INCHANGÉ).
-- On AJOUTE donc juste la consigne d'émettre le bloc de synthèse. Le corps détaillé (règles, sections,
-- profondeur) des prompts v3 (132) est CONSERVÉ tel quel — aucune perte d'information.
--
-- Idempotent : on n'ajoute rien si le prompt contient déjà '##RELYKA'.
-- ============================================================================

-- 1) Les 3 analyses : bloc de synthèse en tête, PUIS les sections détaillées existantes.
UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $spec$SYNTHÈSE EN TÊTE (OBLIGATOIRE) — commence TA RÉPONSE par ce bloc technique (l'app le transforme en cartes de synthèse), EXACTEMENT ainsi, une info par ligne :
##RELYKA
verdict: <UNE seule phrase : la conclusion la plus importante de cette analyse, mise en relation (pas un chiffre sec)>
tag: <2-3 mots, ex. Bonne direction / À consolider / Sous tension>
signal: <libellé court> | <good|watch|over> | <repère chiffré en 3-5 mots>
signal: <...> (2 à 3 signaux MAX, les plus parlants — good = sain, watch = à surveiller, over = problème réel)
action: <verbe + objet, court> | <délai ou coût, ex. Cette semaine / 15 min / 0 €>
action: <...> (2 à 3 actions MAX, classées par IMPACT — la n°1 est la plus prioritaire)
##END
Puis SAUTE une ligne et développe en sections détaillées (voir CE QUE TU DOIS PRODUIRE). Le bloc RÉSUME, il ne REMPLACE PAS les sections : garde toute la profondeur en dessous. N'écris rien d'autre dans le bloc, aucun **gras** ni puce à l'intérieur, et n'invente aucun chiffre (mêmes règles que le reste).$spec$
WHERE key IN ('analysis_expenses', 'analysis_global', 'analysis_reco')
  AND prompt_template NOT LIKE '%##RELYKA%';

-- 2) Bilan de santé : imposer la ligne « score » dans le bloc (recopie du score global du snapshot).
UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $g$PRÉCISION pour ce bilan : dans le bloc ##RELYKA, ajoute une ligne « score: <0-100> » juste après « verdict: », en RECOPIANT le score global de la section SCORE DE SANTÉ FINANCIÈRE (ne le recalcule pas). Choisis les signaux parmi Sécurité / Trésorerie / Budget / Endettement selon ce qui ressort.$g$
WHERE key = 'analysis_global'
  AND prompt_template NOT LIKE '%score: <0-100>%';

-- 3) Chat (question directe) : synthèse OPTIONNELLE, insérée AVANT « FORMAT DE RÉPONSE : » (donc avant
--    la question), pour rester adaptatif — bloc seulement si la question porte sur SA situation.
UPDATE public.ai_prompts
SET prompt_template = replace(
  prompt_template,
  'FORMAT DE RÉPONSE :',
  $c$SYNTHÈSE VISUELLE (OPTIONNELLE — selon la question) : si la question porte sur SA situation (bilan, « où j'en suis », « que faire de X », « est-ce que je peux me permettre… »), tu PEUX ouvrir par un bloc de synthèse rendu en cartes :
##RELYKA
verdict: <une phrase>
signal: <libellé> | <good|watch|over> | <repère chiffré>
action: <verbe + objet> | <délai/coût>
##END
(1 à 3 signaux, 1 à 3 actions, SANS score.) Puis saute une ligne et développe. Pour une question FACTUELLE, générale ou simple, réponds DIRECTEMENT sans bloc — reste naturel et adapté à la question.

FORMAT DE RÉPONSE :$c$)
WHERE key = 'chat_system'
  AND prompt_template NOT LIKE '%##RELYKA%';

NOTIFY pgrst, 'reload schema';
