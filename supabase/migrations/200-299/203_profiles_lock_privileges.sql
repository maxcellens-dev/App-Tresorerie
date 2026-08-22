-- ============================================================================
-- 203 — VERROUILLAGE DES COLONNES DE PRIVILÈGE DU PROFIL.
--
-- ⛔ LA FAILLE CORRIGÉE ICI EST CRITIQUE. À jouer sans attendre.
--
-- ── Ce qui était possible ────────────────────────────────────────────────────────────────────────
-- La table `profiles` porte trois colonnes de DROITS — `is_admin`, `is_premium`, `premium_manual` —
-- au milieu de colonnes ordinaires (prénom, avatar, devise, marge de sécurité). Or sa policy
-- d'écriture dit simplement « chacun modifie sa propre ligne » :
--
--     CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
--
-- Aucune restriction de colonne. Et l'app parle DIRECTEMENT à PostgREST : la clé publique est dans
-- le bundle (c'est sa raison d'être), le jeton de session est celui d'une connexion normale. Rejouer
-- une requête de l'app en changeant son contenu ne demande donc ni outil ni compétence particulière
-- — les outils de développement d'un navigateur suffisent.
--
-- Conséquences, toutes atteignables par n'importe quel inscrit :
--   1. se donner `is_admin = true` → `is_app_admin()` devient vrai, et cette fonction ouvre
--      SOIXANTE-DIX policies : comptes, transactions, projets, soldes de TOUS les utilisateurs ;
--   2. deuxième chemin vers le même résultat : le déclencheur `set_admin_on_profile_trigger`
--      (migration 004) accordait `is_admin` à quiconque porte une adresse e-mail précise — et cette
--      colonne `email` est elle aussi modifiable par son propriétaire, sans contrainte d'unicité ;
--   3. se donner `is_premium = true` → l'abonnement payant, gratuitement et à vie.
--
-- ── Ce que fait cette migration ──────────────────────────────────────────────────────────────────
-- Un déclencheur remet ces trois colonnes à leur valeur PRÉCÉDENTE à chaque mise à jour, sauf si
-- l'auteur de l'écriture a le droit de les changer. Le reste du profil (prénom, avatar, devise,
-- réglages) continue de se modifier normalement : rien ne change pour l'utilisateur.
--
-- Qui garde le droit d'y toucher :
--   • le SERVEUR (`auth.uid()` nul = clé de service : Edge Functions, webhook RevenueCat, console
--     SQL) — c'est par là que passe désormais l'activation du Premium ;
--   • un ADMINISTRATEUR réel (`is_app_admin()`), pour la gestion des comptes depuis l'admin.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT — le webhook AVANT cette migration.
-- L'activation du Premium après un achat était écrite par le TÉLÉPHONE (`PurchasesSync`,
-- `premium.tsx`). Ces écritures deviennent sans effet ici. La fonction `revenuecat-webhook` a été
-- étendue pour poser le Premium côté serveur, à partir des événements RevenueCat — elle est déjà
-- enregistrée dans le tableau de bord RevenueCat et reçoit déjà tous les événements.
--   1. `supabase functions deploy revenuecat-webhook`
--   2. cette migration
--   3. l'OTA (le client cesse alors d'écrire et attend le serveur)
-- Un achat Android réalisé entre 2 et 3 est bien activé : le webhook ne dépend pas de la version
-- de l'app installée.
--
-- Les abonnés ACTUELS ne sont pas touchés : ce déclencheur bloque les CHANGEMENTS, il ne remet rien
-- à zéro. Qui est Premium aujourd'hui le reste.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profiles_protect_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Écriture SERVEUR (clé de service, console SQL, déclencheur d'inscription) : aucun utilisateur
  -- derrière la requête, donc rien à s'accorder à soi-même.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Administrateur réel (lu hors RLS par une fonction SECURITY DEFINER, cf. migration 101).
  IF public.is_app_admin() THEN
    RETURN NEW;
  END IF;

  -- Tout le reste : les droits ne bougent pas, quoi que dise la requête. On ne LÈVE pas d'erreur —
  -- la mise à jour légitime qui l'accompagne (prénom, avatar…) doit aboutir.
  NEW.is_admin       := OLD.is_admin;
  NEW.is_premium     := OLD.is_premium;
  NEW.premium_manual := OLD.premium_manual;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileges_trg ON public.profiles;
CREATE TRIGGER profiles_protect_privileges_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_privileges();

-- ── Le déclencheur « e-mail = administrateur » disparaît ────────────────────────────────────────
-- Il accordait `is_admin` sur la seule foi de `profiles.email` — une colonne que l'utilisateur
-- modifie lui-même, et qui n'a même pas de contrainte d'unicité. Il suffisait donc d'y écrire
-- l'adresse en question.
--
-- ⚠️ À ne pas confondre avec l'attribution faite à l'INSCRIPTION (`handle_new_user`, migration 177) :
-- celle-là lit `auth.users.email`, l'adresse d'authentification réelle — unique, et non modifiable
-- sans confirmation sur la boîte mail. Elle reste en place, c'est elle qui amorce les comptes
-- administrateurs.
--
-- Effet de bord corrigé au passage : ce déclencheur s'exécutait AUSSI à l'insertion, APRÈS
-- `handle_new_user`, et écrasait son résultat — il ne reconnaissait qu'une seule des deux adresses
-- administratrices. La seconde ne recevait donc jamais ses droits à l'inscription.
--
-- Les administrateurs existants gardent leur droit : la colonne n'est pas touchée ici.
DROP TRIGGER IF EXISTS set_admin_on_profile_trigger ON public.profiles;
DROP FUNCTION IF EXISTS public.set_admin_on_profile();

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup (à jouer connecté en tant qu'un utilisateur NON admin) ───────────────
--   UPDATE profiles SET is_admin = true WHERE id = auth.uid();
--   SELECT is_admin FROM profiles WHERE id = auth.uid();   -- doit rendre false
