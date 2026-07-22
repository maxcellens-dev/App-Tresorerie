-- ============================================================================
-- 153 — Conseils IA : DIFFÉRENCIER la synthèse (bloc ##RELYKA) selon l'analyse.
--
-- Retour utilisateur : les 3 analyses affichaient les MÊMES cartes en tête (score + point fort +
-- vigilance + radar), ce qui semblait répétitif et pas adapté à chaque analyse.
-- Le rendu masque déjà proprement les champs absents (pas de score → pas d'anneau ; pas de protege
-- → pas de carte). On DIT donc à chaque analyse quels champs remplir, pour un début de réponse
-- propre à son sujet. (Le bilan global garde la synthèse complète des migrations 149 + 152.)
--
-- Idempotent : guard « SYNTHÈSE PROPRE À CETTE ANALYSE ».
-- ============================================================================

-- DÉPENSES : pas de score, pas de point fort/vigilance ; signaux = tes postes de dépenses ; actions = où réduire.
UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $e$SYNTHÈSE PROPRE À CETTE ANALYSE (dépenses) — dans le bloc ##RELYKA : N'INCLUS PAS « score », NI « protege », NI « vigilance ».
- verdict : ce qui ressort vraiment de tes dépenses (le vrai levier d'économie).
- signal : tes 2-3 POSTES les plus notables — « <Poste> | over|watch|good | <montant/mois> » (over = dépassement, watch = à surveiller, good = maîtrisé).
- action : 2-3 gestes concrets « où réduire », classés par gain.$e$
WHERE key = 'analysis_expenses'
  AND prompt_template NOT LIKE '%SYNTHÈSE PROPRE À CETTE ANALYSE%';

-- RECO : pas de score ; le PLAN est la star ; point fort/vigilance facultatifs.
UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $r$SYNTHÈSE PROPRE À CETTE ANALYSE (plan d'action) — dans le bloc ##RELYKA : N'INCLUS PAS « score ». « protege »/« vigilance » FACULTATIFS (seulement si vraiment pertinents).
- verdict : l'orientation clé de ton plan (où tu devrais mettre ton énergie/argent).
- signal : 1-2 repères qui cadrent le plan (surplus disponible, coussin, grosse échéance à provisionner).
- action : les 2-3 mouvements à faire, classés par IMPACT — c'est le CŒUR de cette analyse.$r$
WHERE key = 'analysis_reco'
  AND prompt_template NOT LIKE '%SYNTHÈSE PROPRE À CETTE ANALYSE%';

-- BILAN GLOBAL : synthèse complète (score + point fort + vigilance + radar). On le rappelle explicitement.
UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $g$SYNTHÈSE PROPRE À CETTE ANALYSE (bilan de santé) — dans le bloc ##RELYKA : INCLUS « score » (recopié), « protege », « vigilance », et 3 signaux parmi Sécurité / Trésorerie / Endettement / Budget.$g$
WHERE key = 'analysis_global'
  AND prompt_template NOT LIKE '%SYNTHÈSE PROPRE À CETTE ANALYSE%';

NOTIFY pgrst, 'reload schema';
