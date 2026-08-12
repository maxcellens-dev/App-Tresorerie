-- ============================================================================
-- 176 — Cycle de vie d'un compte : suppression fiable + diagnostic des orphelins.
--
-- Contexte : un utilisateur a créé son compte, l'a supprimé, l'a recréé — et il ne reste plus
-- aucune ligne dans `profiles`. Deux failles rendaient ce scénario possible et, surtout,
-- INDÉTECTABLE côté admin.
--
-- 1) `delete_own_account` (024) énumère à la main les tables à vider. Cette liste date de la
--    migration 24 et n'a jamais suivi les ~150 suivantes (crédits, IA, comptes partagés, succès…).
--    Elle est en réalité INUTILE — tout ce qui appartient à un utilisateur descend de
--    `auth.users` ou de `profiles` en ON DELETE CASCADE — mais elle n'est pas inoffensive :
--    quatre tables d'ADMINISTRATION référencent `auth.users(id)` SANS clause ON DELETE (donc
--    NO ACTION). Si l'utilisateur a un jour écrit dans l'une d'elles, le `DELETE FROM auth.users`
--    final lève une violation de clé étrangère, TOUTE la fonction est annulée (une seule
--    transaction) et le compte reste en place alors que l'app annonce un échec générique.
--
-- 2) Rien ne permettait de VOIR l'état réel : un compte Auth sans profil (le déclencheur
--    `handle_new_user` a échoué, ou l'inscription n'a jamais été confirmée) est invisible depuis
--    la table `profiles`, la seule que l'admin consulte. D'où « je ne vois plus son compte » sans
--    pouvoir trancher entre « supprimé », « jamais recréé » et « recréé mais cassé ».
-- ============================================================================

-- ── 1. Références d'administration : ne plus jamais bloquer la suppression d'un compte ──
-- On passe ces quatre clés étrangères en ON DELETE SET NULL. Sémantiquement c'est ce qu'on veut :
-- « qui a modifié ce réglage » est une trace d'audit, pas une raison de retenir un compte en vie.
-- Recherche par CATALOGUE (les noms de contraintes sont générés par PostgreSQL et peuvent différer
-- d'un environnement à l'autre) ; chaque table est optionnelle, l'une d'elles peut ne pas exister.
DO $$
DECLARE
  t record;
  v_con text;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('profile_matrix_config', 'updated_by'),
      ('profile_notification_messages', 'updated_by'),
      ('roadmap_ideas', 'created_by'),
      ('fiscal_envelope_rates', 'updated_by'),
      ('recommendation_settings', 'updated_by')
    ) AS v(tbl, col)
  LOOP
    SELECT con.conname INTO v_con
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND rel.relname = t.tbl
      AND att.attname = t.col
      AND array_length(con.conkey, 1) = 1
      AND con.confdeltype = 'a'   -- 'a' = NO ACTION : les autres sont déjà correctes
    LIMIT 1;

    IF v_con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.tbl, v_con);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
        t.tbl, v_con, t.col);
    END IF;
    v_con := NULL;
  END LOOP;
END $$;

-- ── 2. `delete_own_account` : une seule vérité, la cascade ──
-- Supprimer la ligne `auth.users` efface `profiles` (ON DELETE CASCADE) et, de proche en proche,
-- TOUTES les données de l'utilisateur — y compris les tables créées après la migration 024, que
-- l'ancienne liste manuelle ignorait. On VÉRIFIE ensuite que le profil a bien disparu : mieux vaut
-- lever ici, où l'app affiche l'erreur, que laisser l'utilisateur croire son compte effacé.
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  DELETE FROM auth.users WHERE id = uid;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = uid) THEN
    RAISE EXCEPTION 'Suppression incomplète du compte %', uid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ── 3. Diagnostic admin : les comptes Auth SANS profil ──
-- Un compte inscrit dont le profil n'a pas été créé (déclencheur en échec) ou jamais confirmé
-- n'apparaît NULLE PART aujourd'hui. `confirmed_at` distingue les deux cas : NULL = l'e-mail de
-- vérification n'a jamais été ouvert (l'inscription n'est pas allée au bout), non-NULL = compte
-- validé dont le profil manque réellement — là, il y a un incident à réparer.
CREATE OR REPLACE FUNCTION public.admin_auth_orphans()
RETURNS TABLE(id uuid, email text, created_at timestamptz, confirmed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth STABLE AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RETURN; END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at, u.email_confirmed_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
    ORDER BY u.created_at DESC
    LIMIT 200;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_auth_orphans() TO authenticated;

NOTIFY pgrst, 'reload schema';
