-- Migration 092 : avatar « solide et logique ».
--
-- Modèle : profiles.avatar_url est la SEULE source de vérité de la photo de profil.
--   • NULL  → aucun avatar (placeholder). L'app ne retombe PLUS sur l'avatar Google.
--   • non-NULL → photo choisie par l'utilisateur (ou semée depuis Google à la création).
--
-- Problème corrigé : l'app affichait `profile.avatar_url ?? user_metadata.avatar_url`.
-- Résultat : une photo SUPPRIMÉE (avatar_url = NULL) réaffichait l'image Google « par
-- défaut », et on ne distinguait pas « jamais défini » de « supprimé volontairement ».
--
-- Correctif (2 volets) :
--   1) Côté app : suppression du repli sur user_metadata (fait dans le code).
--   2) Côté base : on SÈME l'avatar Google dans profiles.avatar_url À LA CRÉATION du
--      compte uniquement (jamais sur conflit) → un nouvel utilisateur Google garde son
--      image « de base », mais tout changement/suppression ultérieur fait foi.

-- ── 1. Trigger de création de profil : seed de l'avatar OAuth (INSERT uniquement) ──
-- L'avatar Google arrive dans raw_user_meta_data sous 'avatar_url' (parfois 'picture').
-- On NE le met PAS dans le DO UPDATE → il n'écrase jamais une valeur existante.
CREATE OR REPLACE FUNCTION public.handle_new_user()
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
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    -- avatar_url VOLONTAIREMENT ABSENT ici : on ne réécrit jamais le choix utilisateur.
    is_admin = EXCLUDED.is_admin;
  RETURN NEW;
END;
$$;

-- ── 2. Backfill : comptes existants sans avatar → on sème l'avatar OAuth s'il existe ──
-- (Les comptes qui ont déjà une photo personnalisée ne sont pas touchés. Ceux qui
--  affichaient l'avatar Google via l'ancien repli retrouvent ainsi leur image de base.)
UPDATE public.profiles p
SET avatar_url = NULLIF(COALESCE(u.raw_user_meta_data->>'avatar_url',
                                 u.raw_user_meta_data->>'picture', ''), '')
FROM auth.users u
WHERE u.id = p.id
  AND (p.avatar_url IS NULL OR p.avatar_url = '')
  AND NULLIF(COALESCE(u.raw_user_meta_data->>'avatar_url',
                      u.raw_user_meta_data->>'picture', ''), '') IS NOT NULL;
