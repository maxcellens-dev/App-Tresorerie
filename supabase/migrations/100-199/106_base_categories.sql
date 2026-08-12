-- ============================================================================
-- 106 — Catégories de BASE éditables par l'admin (#3).
--
-- Référentiel commun `base_categories` (édité par l'admin) propagé aux copies par-user `categories`.
-- Règles : on AJOUTE les nouveautés, on met à jour le PLACEMENT (sort_order/parent), on met à jour le
-- NOM uniquement si le user ne l'a PAS renommé (user_renamed=false). Suppression côté base = ARCHIVAGE
-- (is_active=false) : on cesse d'ajouter, mais les users existants conservent (transactions historiques).
-- Propagation déclenchée manuellement par l'admin (RPC apply_base_categories).
-- ============================================================================

-- 1) Référentiel ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.base_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('income','expense')),
  parent_id uuid REFERENCES public.base_categories(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_variable boolean NOT NULL DEFAULT false,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.base_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS base_cat_read ON public.base_categories;
DROP POLICY IF EXISTS base_cat_write ON public.base_categories;
-- Lecture : tous les utilisateurs connectés (référentiel public). Écriture : admin uniquement.
CREATE POLICY base_cat_read ON public.base_categories FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY base_cat_write ON public.base_categories FOR ALL USING (is_app_admin()) WITH CHECK (is_app_admin());

-- 2) Lien copies par-user -> référentiel + protection des renommages ---------
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS base_id uuid REFERENCES public.base_categories(id) ON DELETE SET NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS user_renamed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS categories_base ON public.categories(base_id);

-- 3) Seed du référentiel depuis le template (idempotent : seulement si vide) -
DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM public.base_categories) THEN RETURN; END IF;

  -- Parents
  INSERT INTO public.base_categories (name, type, is_variable, sort_order) VALUES
    ('Revenu','income',false,0),
    ('Autres recettes','income',false,10),
    ('Aides & Subventions','income',false,20),
    ('Prêts & Finance','income',false,30),
    ('Mouvements','expense',false,-10),
    ('Frais variables','expense',true,0),
    ('Santé, assurance','expense',false,10),
    ('Logement','expense',false,20),
    ('Abonnements, Forfaits','expense',false,30),
    ('Frais bancaires et financiers','expense',false,40),
    ('Impôts et taxes','expense',false,50),
    ('Autres dépenses','expense',true,60);

  -- Enfants (héritent du sort_order + is_variable du parent ; tri par nom).
  INSERT INTO public.base_categories (name, type, parent_id, is_variable, sort_order)
  SELECT ch, p.type, p.id, p.is_variable, p.sort_order
  FROM public.base_categories p
  JOIN (VALUES
    ('Revenu', ARRAY['Gérant Société','Salaire, Traitement','Dividendes']),
    ('Autres recettes', ARRAY['Autres produits','Remboursements','Régularisation Solde']),
    ('Aides & Subventions', ARRAY['CAF','CPF','Dons']),
    ('Prêts & Finance', ARRAY['Apport personnels','Intérêts bancaires']),
    ('Mouvements', ARRAY['Épargne','Investissements','Régularisation solde']),
    ('Frais variables', ARRAY['Courses','Restaurants','Loisirs','Autres frais personnels','Transports en commun','Véhicule, Carburant','Projets','Animaux','Vêtements','Vacances']),
    ('Santé, assurance', ARRAY['Mutuelle','Assurance Santé']),
    ('Logement', ARRAY['Loyer','Copropriété','Taxe d''habitation','Taxe foncière','Assurance habitation','Electricité, Eau, Gaz']),
    ('Abonnements, Forfaits', ARRAY['Autres abonnements','Internet mobile','Plateformes Streaming','Box internet','Sport']),
    ('Frais bancaires et financiers', ARRAY['Assurance Crédit','Frais bancaires','Autres frais','Crédits']),
    ('Impôts et taxes', ARRAY['Impôt sur le revenu','Autres Impôts']),
    ('Autres dépenses', ARRAY['Divers','Autres charges'])
  ) AS seed(pname, children) ON seed.pname = p.name AND p.parent_id IS NULL
  CROSS JOIN LATERAL unnest(seed.children) AS ch;
END $seed$;

-- 4) Lier les copies existantes au référentiel (par type + nom). Les catégories déjà renommées
--    (nom différent) ne matchent pas → restent « custom » (non écrasées), comportement voulu.
UPDATE public.categories c
SET base_id = bc.id
FROM public.base_categories bc
WHERE c.base_id IS NULL
  AND COALESCE(c.is_default, false) = true
  AND c.type = bc.type
  AND lower(btrim(c.name)) = lower(btrim(bc.name));

-- 5) Propagation manuelle (admin) : ajoute / replace / met à jour les noms non renommés -----
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
  UPDATE public.categories c
  SET parent_id = pc.id
  FROM public.base_categories bc
  JOIN public.base_categories bp ON bp.id = bc.parent_id
  JOIN public.categories pc ON pc.base_id = bp.id AND pc.profile_id = c.profile_id
  WHERE c.base_id = bc.id AND bc.parent_id IS NOT NULL;

  -- e) Mettre à jour le NOM uniquement si le user ne l'a pas renommé.
  UPDATE public.categories c
  SET name = bc.name
  FROM public.base_categories bc
  WHERE c.base_id = bc.id AND c.user_renamed = false;
END $$;
GRANT EXECUTE ON FUNCTION public.apply_base_categories() TO authenticated;
