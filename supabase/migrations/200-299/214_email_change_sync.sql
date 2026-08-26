-- ============================================================================
-- 214 — CHANGEMENT D'ADRESSE E-MAIL : GARDER `profiles.email` EN PHASE.
--
-- ── Le problème ─────────────────────────────────────────────────────────────────────────────
-- L'adresse de connexion vit dans `auth.users.email`. L'application en garde une COPIE dans
-- `profiles.email`, écrite une seule fois, à l'inscription (`handle_new_user`). Tant que personne ne
-- pouvait changer d'adresse, la copie restait juste par construction.
--
-- Ce n'est plus le cas : l'écran « Changer d'adresse e-mail » permet désormais d'en demander une
-- nouvelle, et Supabase la remplace dans `auth.users` une fois le lien de confirmation ouvert. Sans
-- le déclencheur ci-dessous, `profiles.email` conserverait l'ANCIENNE adresse — celle qui s'affiche
-- dans le panneau d'administration, sur chaque demande d'assistance, et dans les exports de données.
-- On écrirait à une adresse que la personne a précisément quittée.
--
-- ── Ce que fait ce déclencheur ──────────────────────────────────────────────────────────────
-- À chaque modification de l'adresse dans `auth.users`, la copie du profil suit. Il couvre TOUS les
-- chemins, pas seulement l'écran de l'app : confirmation par lien, changement depuis la console
-- Supabase, correction faite par le support.
--
-- `AFTER UPDATE OF email` : le déclencheur ne se réveille que quand cette colonne bouge — pas à
-- chaque connexion (qui met à jour `last_sign_in_at` et rejouerait le déclencheur pour rien).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Supabase renseigne l'adresse par étapes pendant un changement (`email_change` puis `email`) :
  -- on ne recopie que lorsqu'elle a réellement changé, et jamais une valeur vide.
  IF NEW.email IS DISTINCT FROM OLD.email AND COALESCE(NEW.email, '') <> '' THEN
    UPDATE public.profiles SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_trg ON auth.users;
CREATE TRIGGER sync_profile_email_trg
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- ── Rattrapage des copies déjà divergentes ──────────────────────────────────────────────────
-- Rien ne garantit que les deux tables soient d'accord aujourd'hui (adresse corrigée à la main
-- depuis la console, profil réparé par la migration 177…). On aligne une fois pour toutes.
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id
   AND COALESCE(u.email, '') <> ''
   AND p.email IS DISTINCT FROM u.email;

NOTIFY pgrst, 'reload schema';

-- ── Vérification ────────────────────────────────────────────────────────────────────────────
--   SELECT count(*) FROM profiles p JOIN auth.users u ON u.id = p.id
--    WHERE p.email IS DISTINCT FROM u.email AND COALESCE(u.email,'') <> '';   -- doit rendre 0
