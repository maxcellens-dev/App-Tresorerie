-- ============================================================================
-- 201 — Conseils IA : liste des analyses SANS exposer les prompts.
--
-- `ai_prompts` est en lecture pour tout utilisateur authentifié (policy de la migration 113), et la
-- page Conseils Intelligents faisait un `select *` : chaque utilisateur téléchargeait donc le TEXTE
-- INTÉGRAL des modèles de prompt (la méthode d'analyse de l'app) alors qu'il n'a besoin que du
-- TITRE des analyses proposées.
--
-- Cette migration livre la fonction qui remplace cette lecture. Elle est 100 % ADDITIVE : rien
-- n'est retiré, aucun client — même très ancien — ne change de comportement.
--
-- La FERMETURE de la table est dans la migration 202, volontairement séparée : elle rendrait la
-- liste des analyses vide pour un client qui n'a pas encore `useAiAnalyses`. Voir 202 pour la
-- condition à remplir avant de la jouer.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_analyses()
RETURNS TABLE (key text, title text, sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.key, p.title, p.sort_order
  FROM public.ai_prompts p
  WHERE p.is_active = true AND p.key LIKE 'analysis\_%'
  ORDER BY p.sort_order;
$$;
REVOKE ALL ON FUNCTION public.ai_analyses() FROM public;
GRANT EXECUTE ON FUNCTION public.ai_analyses() TO authenticated;

NOTIFY pgrst, 'reload schema';
