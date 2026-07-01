-- ============================================================================
-- 116 — Fix propagation des catégories de base.
--   (1) Bug SQL « invalid reference to FROM-clause entry for table c » : dans l'UPDATE de re-parentage
--       (étape d), la table cible `c` était référencée dans un JOIN du FROM (interdit en Postgres) →
--       on déplace la condition dans le WHERE.
--   (2) La 106 n'avait pas de `NOTIFY pgrst` → la fonction pouvait rester absente du cache PostgREST
--       (RPC en 404). On recrée la fonction et on recharge le cache.
-- ============================================================================

-- Colonnes de liaison garanties (au cas où la 106 n'aurait pas tout appliqué).
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS base_id uuid REFERENCES public.base_categories(id) ON DELETE SET NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS user_renamed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.apply_base_categories() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Réservé à l''administrateur'; END IF;

  -- a) Ajouter les PARENTS de base manquants à chaque user.
  INSERT INTO public.categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order, base_id, user_renamed)
  SELECT u.profile_id, bc.name, bc.type, NULL, true, bc.is_variable, bc.sort_order, bc.id, false
  FROM public.base_categories bc
  CROSS JOIN (SELECT DISTINCT profile_id FROM public.categories) u
  WHERE bc.is_active AND bc.parent_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.profile_id = u.profile_id AND c.base_id = bc.id);

  -- b) Ajouter les ENFANTS de base manquants (le parent user doit déjà exister, lié au parent de base).
  INSERT INTO public.categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order, base_id, user_renamed)
  SELECT u.profile_id, bc.name, bc.type, pc.id, true, bc.is_variable, bc.sort_order, bc.id, false
  FROM public.base_categories bc
  JOIN public.base_categories bp ON bp.id = bc.parent_id
  CROSS JOIN (SELECT DISTINCT profile_id FROM public.categories) u
  JOIN public.categories pc ON pc.profile_id = u.profile_id AND pc.base_id = bp.id
  WHERE bc.is_active AND bc.parent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.profile_id = u.profile_id AND c.base_id = bc.id);

  -- c) Mettre à jour le PLACEMENT (sort_order + is_variable) de toutes les copies liées.
  UPDATE public.categories c
  SET sort_order = bc.sort_order, is_variable = bc.is_variable
  FROM public.base_categories bc WHERE c.base_id = bc.id;

  -- d) Re-parenter les enfants vers la copie user du nouveau parent de base.
  --    ✅ Correction : la référence à la cible `c` va dans le WHERE (pas dans un JOIN du FROM).
  UPDATE public.categories c
  SET parent_id = pc.id
  FROM public.base_categories bc
  JOIN public.base_categories bp ON bp.id = bc.parent_id
  JOIN public.categories pc ON pc.base_id = bp.id
  WHERE c.base_id = bc.id AND bc.parent_id IS NOT NULL AND pc.profile_id = c.profile_id;

  -- e) Mettre à jour le NOM uniquement si le user ne l'a pas renommé.
  UPDATE public.categories c
  SET name = bc.name
  FROM public.base_categories bc
  WHERE c.base_id = bc.id AND c.user_renamed = false;
END $$;
GRANT EXECUTE ON FUNCTION public.apply_base_categories() TO authenticated;

NOTIFY pgrst, 'reload schema';
