-- ============================================================================
-- 151 — Conseils IA : STYLE DE TEXTE propre pour le rendu en cartes (components/AiRichText).
--
-- Le rendu gère markdown léger, mais certains modèles produisent du bruit qui s'affiche mal /
-- alourdit : backticks autour des montants (`2519 €`), séparateurs --- / ***, citations « > »,
-- *italique* en étoile simple, et des sections « inventaire » (récap comptes/soldes) que les prompts
-- interdisent déjà mais que le modèle rajoute parfois. On ajoute une consigne de STYLE explicite.
--
-- Idempotent : n'ajoute rien si la consigne est déjà présente.
-- ============================================================================

UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $style$STYLE DU TEXTE (l'app rend ta réponse en CARTES — respecte-le pour un affichage net) :
- Titres de section : « **🎯 Titre** » (gras + emoji), et RIEN d'autre en gras sur la ligne de titre.
- Montants importants en **gras**. N'utilise JAMAIS : de backticks `…` autour des chiffres, de séparateurs (--- ou ***), de citations « > », ni d'italique en *étoile simple*.
- Puces avec « - ». Pas de tableaux.
- PAS de section « inventaire » qui récapitule les comptes/soldes/patrimoine : va droit à l'analyse (le récap est déjà dans l'app).$style$
WHERE key IN ('analysis_expenses', 'analysis_global', 'analysis_reco', 'chat_system')
  AND prompt_template NOT LIKE '%STYLE DU TEXTE%';

NOTIFY pgrst, 'reload schema';
