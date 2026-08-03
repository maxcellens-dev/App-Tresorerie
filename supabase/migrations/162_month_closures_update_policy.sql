-- ============================================================================
-- 162 — Clôture mensuelle : la policy UPDATE manquante (le mois ne passait jamais au suivant).
--
-- BUG : `month_closures` (migration 040) porte des policies SELECT / INSERT / DELETE, mais AUCUNE
-- policy UPDATE. Or le client clôture avec un UPSERT :
--
--     .upsert(rows, { onConflict: 'profile_id,month_key' })
--
-- Un upsert qui retombe sur une ligne existante exécute un UPDATE → refusé par RLS.
--
-- Et une ligne existe presque toujours : le marquage automatique `estimated`
-- (hooks/useMonthlyClosure) insère une ligne pour chaque mois passé le délai de grâce. D'où le
-- symptôme exact signalé : clôturer le mois le plus récent fonctionne (INSERT), clôturer un mois
-- plus ancien échoue (UPDATE) — les régularisations, créées AVANT l'upsert, sont bien enregistrées,
-- mais la modale ne passe jamais au mois suivant.
--
-- (Pourquoi « ça marche en admin » : un admin teste en général sur le mois précédent, encore dans
--  le délai de grâce, donc sans ligne `estimated` → chemin INSERT.)
--
-- Correctif : ajouter la policy UPDATE, symétrique des autres (on ne touche QUE ses propres lignes).
-- ============================================================================

DROP POLICY IF EXISTS "month_closures_update" ON public.month_closures;
CREATE POLICY "month_closures_update" ON public.month_closures FOR UPDATE TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

NOTIFY pgrst, 'reload schema';
