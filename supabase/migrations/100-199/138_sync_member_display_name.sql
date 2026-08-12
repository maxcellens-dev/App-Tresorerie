-- Migration 138 : le nom affiché d'un participant INSCRIT suit « Mon profil ».
--
-- Problème : rw_participants / account_members / credit_members stockent un `display_name` copié
-- une seule fois depuis profiles.full_name au moment de l'acceptation de l'invitation
-- (cf. rw_accept_invitation, migrations 069/076/097/110). Si l'utilisateur change ensuite son nom
-- dans « Mon profil », les projets, comptes et crédits partagés continuent d'afficher l'ancien.
--
-- Choix : propager depuis profiles, plutôt que résoudre le nom à la lecture côté client.
--   • la RLS de `profiles` n'autorise pas à lire le profil des AUTRES membres → une jointure côté
--     client renverrait NULL pour eux (c'est justement le cas d'usage : voir le nom des autres) ;
--   • `display_name` reste une colonne simple, aucune requête existante n'est à réécrire.
--
-- Périmètre : uniquement les lignes rattachées à un compte utilisateur (user_id = profil modifié).
-- Les participants NON INSCRITS (user_id IS NULL) gardent le nom saisi à la main : ils n'ont pas de
-- profil, et ce nom est la seule chose qui les identifie.
-- Effet de bord assumé : un participant inscrit que le propriétaire aurait renommé à la main
-- (rw_rename_participant) reprend son nom de profil au prochain changement de nom. C'est le
-- comportement demandé — le profil fait autorité pour les personnes inscrites.

CREATE OR REPLACE FUNCTION public.sync_member_display_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Un nom vide ne doit pas écraser un nom existant (« Invité » vaut mieux que rien).
  IF COALESCE(NULLIF(trim(NEW.full_name), ''), '') = '' THEN
    RETURN NEW;
  END IF;

  UPDATE public.rw_participants SET display_name = trim(NEW.full_name)
    WHERE user_id = NEW.id AND display_name IS DISTINCT FROM trim(NEW.full_name);

  UPDATE public.account_members SET display_name = trim(NEW.full_name)
    WHERE user_id = NEW.id AND display_name IS DISTINCT FROM trim(NEW.full_name);

  UPDATE public.credit_members SET display_name = trim(NEW.full_name)
    WHERE user_id = NEW.id AND display_name IS DISTINCT FROM trim(NEW.full_name);

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_sync_member_display_name ON public.profiles;
CREATE TRIGGER profiles_sync_member_display_name
  AFTER UPDATE OF full_name ON public.profiles
  FOR EACH ROW
  WHEN (NEW.full_name IS DISTINCT FROM OLD.full_name)
  EXECUTE FUNCTION public.sync_member_display_name();

-- Rattrapage : aligner l'existant sur les profils actuels (noms déjà périmés en base).
UPDATE public.rw_participants m SET display_name = trim(p.full_name)
  FROM public.profiles p
  WHERE m.user_id = p.id
    AND COALESCE(NULLIF(trim(p.full_name), ''), '') <> ''
    AND m.display_name IS DISTINCT FROM trim(p.full_name);

UPDATE public.account_members m SET display_name = trim(p.full_name)
  FROM public.profiles p
  WHERE m.user_id = p.id
    AND COALESCE(NULLIF(trim(p.full_name), ''), '') <> ''
    AND m.display_name IS DISTINCT FROM trim(p.full_name);

UPDATE public.credit_members m SET display_name = trim(p.full_name)
  FROM public.profiles p
  WHERE m.user_id = p.id
    AND COALESCE(NULLIF(trim(p.full_name), ''), '') <> ''
    AND m.display_name IS DISTINCT FROM trim(p.full_name);
