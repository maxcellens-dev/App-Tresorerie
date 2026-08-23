-- ============================================================================
-- 204 — LA CONFIGURATION DE L'APP N'EST PLUS MODIFIABLE PAR N'IMPORTE QUEL INSCRIT.
--
-- ⛔ FAILLE CRITIQUE. Même famille que la migration 203 (colonnes de privilège du profil).
--
-- ── Ce qui était possible ────────────────────────────────────────────────────────────────────────
-- La table `app_config` est un SINGLETON qui porte toute la configuration globale : la page
-- d'accueil (`landing`), le thème et les polices (`theme`), les drapeaux de fonctionnalités
-- (`features`, dont la COUPURE GLOBALE `app_lockdown_enabled`), les limites d'usage
-- (`usage_limits`), le SEO (`seo`), les mentions légales (`legal`), les publicités (`ads`), la
-- gamification, le Pouls, la fiabilité, les gabarits de notification admin…
--
-- Sa policy d'écriture, posée à la migration 001, dit littéralement « tout utilisateur connecté » :
--
--     CREATE POLICY "Allow authenticated update app_config"
--       ON app_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
--
-- Aucune vérification de rôle. Comme l'app parle DIRECTEMENT à PostgREST avec la clé publique et un
-- jeton de session ordinaire, n'importe quel inscrit pouvait, depuis les outils de développement de
-- son navigateur :
--   1. COUPER L'APPLICATION POUR TOUT LE MONDE (`features.app_lockdown_enabled = true`) — déni de
--      service global en une requête ;
--   2. réécrire la page d'accueil publique : textes, images, liens (donc y placer une URL de
--      hameçonnage sous la marque Relyka) ;
--   3. lever ses propres limites d'usage (`usage_limits`) ;
--   4. réécrire les mentions légales et la politique de confidentialité ;
--   5. défigurer le SEO et le thème de toute l'app.
--
-- ── Ce que fait cette migration ──────────────────────────────────────────────────────────────────
-- L'écriture est réservée aux ADMINISTRATEURS réels (`is_app_admin()`, cf. migration 101 — fonction
-- SECURITY DEFINER qui lit `profiles.is_admin` hors RLS, colonne elle-même verrouillée depuis la
-- migration 203, donc on ne peut plus s'auto-promouvoir pour contourner ce garde).
--
-- La LECTURE reste publique : les écrans d'avant-connexion (accueil, connexion, pages légales) et le
-- boot du web en dépendent, et rien de secret n'y est stocké (aucune adresse ni clé — vérifié champ
-- par champ). Les Edge Functions passent par la clé de service : elles ignorent la RLS.
--
-- INSERT et DELETE restaient déjà refusés (aucune policy) : la ligne `default` est unique et créée
-- par la migration 001. On le rend explicite ci-dessous en documentation.
--
-- ── Effet sur l'app ──────────────────────────────────────────────────────────────────────────────
-- AUCUN pour un utilisateur normal : il ne fait que lire. Tous les enregistrements de configuration
-- partent des écrans d'administration (admin/landing, admin/style-editor, admin/features,
-- admin/seo-center, admin/legal, admin/usage-limits, admin/gamification, admin/pouls,
-- admin/reliability, admin/notifications, admin/ads, admin/financial-profiles) — vérifié : aucun
-- appel `update` sur `app_config` en dehors de ces écrans. La recalibration de fiabilité
-- (lib/finance/reliabilityCalib) ne fait que LIRE `app_config.reliability` ; elle écrit dans
-- `profiles.reliability_calib`, qui n'est pas concerné.
--
-- ⚠️ Un admin qui perdrait `is_admin` ne pourrait plus rien enregistrer : c'est voulu.
-- ============================================================================

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Lecture : inchangée (publique). On la réassoit de façon idempotente pour que ce fichier soit
-- rejouable seul sur une base neuve comme sur la production.
DROP POLICY IF EXISTS "Allow public read app_config" ON public.app_config;
DROP POLICY IF EXISTS app_config_read ON public.app_config;
CREATE POLICY app_config_read
  ON public.app_config FOR SELECT
  USING (true);

-- Écriture : ADMINISTRATEURS uniquement.
DROP POLICY IF EXISTS "Allow authenticated update app_config" ON public.app_config;
DROP POLICY IF EXISTS app_config_update ON public.app_config;
CREATE POLICY app_config_update
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Pas de policy INSERT ni DELETE : la ligne singleton `default` ne se crée ni ne se supprime depuis
-- un client. (Sans policy permissive, RLS refuse par défaut.)

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup (connecté en tant qu'un utilisateur NON admin) ───────────────────────
--   UPDATE app_config SET landing = '{}'::jsonb WHERE id = 'default';
--   -- doit rendre « UPDATE 0 » (la ligne n'est pas visible en écriture), et la page d'accueil
--   -- doit rester intacte.
--   SELECT landing IS NOT NULL FROM app_config WHERE id = 'default';   -- doit rendre true
