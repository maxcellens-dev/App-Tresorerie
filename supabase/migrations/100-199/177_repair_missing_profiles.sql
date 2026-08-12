-- ============================================================================
-- 177 — Réparer un compte qui a perdu (ou n'a jamais eu) sa ligne `profiles`.
--
-- Cas réel : un utilisateur SE SERT de l'app — il a donc bien une ligne `auth.users` — mais il
-- n'apparaît nulle part côté admin. Tous les écrans d'administration partent de `profiles` :
-- la recherche, le passage Premium, et surtout « Consulter » (impersonation, qui a besoin de
-- l'identifiant listé). Sans cette ligne, l'utilisateur devient INJOIGNABLE.
--
-- Il ne faut SURTOUT PAS lui faire supprimer son compte : ce serait détruire ses données réelles
-- (comptes, transactions, crédits…) pour contourner l'absence d'une ligne d'index. Le profil est
-- reconstructible à l'identique depuis `auth.users` — c'est exactement ce que fait le déclencheur
-- `handle_new_user` (092) à la création. On rejoue donc la même insertion, après coup.
--
-- 176 DIAGNOSTIQUE (admin_auth_orphans), 177 RÉPARE. Les deux sont idempotents.
-- ============================================================================

-- ── 1. Réparation immédiate : tous les comptes Auth sans profil ──
-- Même logique que `handle_new_user` : e-mail, nom et avatar OAuth semés à la création, rien
-- d'autre. `ON CONFLICT DO NOTHING` → un profil existant n'est jamais touché.
INSERT INTO public.profiles (id, email, full_name, avatar_url, is_admin)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  NULLIF(COALESCE(u.raw_user_meta_data->>'avatar_url',
                  u.raw_user_meta_data->>'picture', ''), ''),
  (lower(COALESCE(u.email, '')) IN ('maxcellens@gmail.com', 'relyka.dev@gmail.com'))
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── 2. Filet permanent : le profil se répare tout seul à la connexion ──
-- Le déclencheur de 092 ne se déclenche qu'à l'INSERT dans `auth.users` : s'il a échoué ce
-- jour-là, plus rien ne rattrape jamais le profil manquant. On ajoute donc le même traitement à
-- la MISE À JOUR (Supabase écrit `last_sign_in_at` à chaque connexion) : le trou se referme de
-- lui-même à la prochaine ouverture de l'app, sans intervention.
CREATE OR REPLACE FUNCTION public.ensure_profile_on_signin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, is_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data->>'avatar_url',
                    NEW.raw_user_meta_data->>'picture', ''), ''),
    (lower(COALESCE(NEW.email, '')) IN ('maxcellens@gmail.com', 'relyka.dev@gmail.com'))
  )
  -- Rien à réécrire sur un profil qui existe : ce déclencheur ne sert qu'à combler une absence.
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_signin_ensure_profile ON auth.users;
CREATE TRIGGER on_auth_user_signin_ensure_profile
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.ensure_profile_on_signin();

-- ── 3. Bouton « Réparer » côté admin ──
-- Recrée les profils manquants à la demande et renvoie le nombre réparé.
CREATE OR REPLACE FUNCTION public.admin_repair_missing_profiles()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, is_admin)
  SELECT
    u.id,
    COALESCE(u.email, ''),
    COALESCE(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(COALESCE(u.raw_user_meta_data->>'avatar_url',
                    u.raw_user_meta_data->>'picture', ''), ''),
    (lower(COALESCE(u.email, '')) IN ('maxcellens@gmail.com', 'relyka.dev@gmail.com'))
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_repair_missing_profiles() TO authenticated;

-- ── 4. Recherche admin : retrouver quelqu'un même sans e-mail ni nom ──
-- `search_users_admin` (161) ne compare que l'e-mail et le nom. Or le déclencheur écrit '' quand
-- `auth.users.email` est vide (connexion par fournisseur, compte réparé sans métadonnées) : un
-- profil aux deux champs vides n'était atteignable par AUCUNE recherche. On accepte donc aussi un
-- identifiant UUID collé tel quel — le dernier recours qui marche toujours.
CREATE OR REPLACE FUNCTION public.search_users_admin(p_query text)
RETURNS TABLE(id uuid, email text, full_name text, created_at timestamptz, last_active timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_like text;
  v_uuid uuid;
BEGIN
  IF NOT public.is_app_admin() THEN RETURN; END IF;
  IF p_query IS NULL OR length(btrim(p_query)) < 2 THEN RETURN; END IF;
  v_like := '%' || btrim(p_query) || '%';
  BEGIN
    v_uuid := btrim(p_query)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_uuid := NULL;   -- recherche texte ordinaire
  END;

  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.created_at, la.last_active
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS last_active FROM public.analytics_events a WHERE a.profile_id = p.id
    ) la ON true
    WHERE p.id <> auth.uid()                        -- jamais soi-même
      AND COALESCE(p.is_admin, false) = false        -- jamais un admin
      AND (p.email ILIKE v_like OR p.full_name ILIKE v_like OR p.id = v_uuid)
    ORDER BY COALESCE(la.last_active, p.created_at) DESC
    LIMIT 50;
END; $$;
GRANT EXECUTE ON FUNCTION public.search_users_admin(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
