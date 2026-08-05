-- ============================================================================
-- 167 — Modèles d'e-mail ÉDITABLES.
--
-- Les trois modèles vivaient en dur dans `_shared/emailTemplate.ts` : impossible d'en corriger un
-- mot sans un déploiement, impossible d'en ajouter un. Ils restent le SOCLE (ils partent avec le
-- code, une base neuve n'est jamais vide), mais cette table permet de les modifier et d'en créer.
--
-- Modèle de fusion, identique aux catégories de base (migration 106) :
--   • une ligne dont l'`id` reprend celui d'un modèle du code  → elle le REMPLACE ;
--   • une ligne avec un id libre                               → c'est un modèle CUSTOM ;
--   • supprimer la ligne d'un modèle du code                   → il revient à sa version d'origine.
-- Aucune copie des modèles du code n'est faite ici : dupliquer ce HTML en SQL, c'est se condamner à
-- le maintenir à deux endroits.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_templates (
  -- TEXT et non UUID : les modèles du socle sont identifiés par leur slug ('nouveaute', 'conseil'…),
  -- c'est ce qui permet à une ligne de se substituer à l'un d'eux.
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_templates IS
  'Modèles d''e-mail éditables. Une ligne dont l''id reprend celui d''un modèle du code le remplace ; '
  'la supprimer restaure la version d''origine. Voir _shared/emailTemplate.ts.';

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Réservé aux admins, dans les deux sens. Les QUATRE verbes sont couverts : une policy UPDATE
-- manquante rendrait tout upsert impossible (le bug de month_closures, migration 162).
DROP POLICY IF EXISTS "email_templates_admin_select" ON public.email_templates;
CREATE POLICY "email_templates_admin_select" ON public.email_templates FOR SELECT TO authenticated
  USING (public.is_app_admin());
DROP POLICY IF EXISTS "email_templates_admin_insert" ON public.email_templates;
CREATE POLICY "email_templates_admin_insert" ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_templates_admin_update" ON public.email_templates;
CREATE POLICY "email_templates_admin_update" ON public.email_templates FOR UPDATE TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_templates_admin_delete" ON public.email_templates;
CREATE POLICY "email_templates_admin_delete" ON public.email_templates FOR DELETE TO authenticated
  USING (public.is_app_admin());
