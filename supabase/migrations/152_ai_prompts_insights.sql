-- ============================================================================
-- 152 — Conseils IA : deux INSIGHTS dans la synthèse (« Ce qui te protège » / « Le vrai point de
-- vigilance ») → rendus en cartes vertes/rouges par l'app (cf. components/AiReport).
--
-- Complète le bloc ##RELYKA (migration 149) avec deux lignes optionnelles. Idempotent.
-- ============================================================================

UPDATE public.ai_prompts
SET prompt_template = prompt_template || E'\n\n' || $ins$DANS LE BLOC ##RELYKA, ajoute aussi ces deux lignes (juste après « tag: ») — une phrase chacune, la SUBSTANCE de ton analyse, pas un chiffre sec :
protege: <ce qui protège l'utilisateur / son point fort structurel, ce qui lui donne de la marge>
vigilance: <LE vrai point d'attention, le plus important — pas le plus visible>
Elles s'affichent en cartes « Ce qui te protège » (vert) et « Le vrai point de vigilance » (rouge).$ins$
WHERE key IN ('analysis_expenses', 'analysis_global', 'analysis_reco')
  AND prompt_template NOT LIKE '%protege:%';

NOTIFY pgrst, 'reload schema';
