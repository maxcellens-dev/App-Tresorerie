-- ============================================================================
-- 212 — ASSISTANCE : INTÉGRITÉ DU FIL DE DISCUSSION.
--
-- ⛔ Deux failles corrigées ici. À jouer AVANT l'OTA qui l'accompagne.
--
-- ── 1. N'IMPORTE QUEL INSCRIT POUVAIT ÉCRIRE UN MESSAGE SIGNÉ « ASSISTANCE » ──────────────────
-- La règle d'écriture des messages (migration 036) vérifiait UNIQUEMENT que la demande appartient
-- bien à l'auteur :
--
--     CREATE POLICY "support_messages_insert" ON support_messages FOR INSERT
--       WITH CHECK (EXISTS (SELECT 1 FROM support_requests r WHERE r.id = request_id AND …));
--
-- Rien sur `sender_role`, rien sur `author_id`. Or l'application parle directement à PostgREST avec
-- la clé publique et un jeton de session ordinaire : rejouer sa propre requête en remplaçant
-- `"sender_role":"user"` par `"admin"` ne demande que les outils de développement d'un navigateur.
-- Le message apparaissait alors dans le fil sous l'étiquette « Assistance » — pour l'utilisateur
-- comme pour l'administrateur qui ouvre la demande. Autrement dit : n'importe qui pouvait fabriquer
-- une réponse de l'équipe et la produire ensuite comme un engagement de notre part.
--
-- ── 2. L'AUTEUR D'UNE DEMANDE POUVAIT EN RÉÉCRIRE TOUTES LES COLONNES ────────────────────────
-- La règle de mise à jour disait « chacun modifie sa propre demande », sans restriction de colonne.
-- Étaient donc modifiables depuis le client :
--   • `admin_unread` → `false` : la demande disparaissait du compteur des administrateurs ;
--   • `profile_email` : le panneau d'administration affiche cette colonne telle quelle, on pouvait
--     donc y faire figurer l'adresse de quelqu'un d'autre ;
--   • `last_message_at` : une date dans le futur épinglait la demande en tête de liste ;
--   • `subject`, `created_at`, `profile_id` : réécriture après coup.
--
-- ── CE QUE FAIT CETTE MIGRATION ──────────────────────────────────────────────────────────────
-- Le SERVEUR décide désormais de tout ce qui n'appartient pas à l'utilisateur :
--   • le rôle d'un message et son auteur sont déduits de l'identité de l'appelant, jamais reçus ;
--   • l'horodatage de la demande et les drapeaux « non lu » sont posés par un déclencheur, à
--     l'insertion du message — le client n'a plus à les écrire (il le faisait sans même vérifier
--     que ça avait fonctionné : une mise à jour refusée passait inaperçue et la réponse n'était
--     jamais signalée à son destinataire) ;
--   • les colonnes d'identité et de classement sont restaurées à leur valeur précédente pour tout
--     appelant qui n'est pas administrateur ;
--   • longueurs bornées et nombre de demandes par jour limité (une zone de texte libre ouverte à
--     tous, sans limite, est une invitation).
--
-- Rien ne change pour un utilisateur qui se sert de l'application normalement.
-- ============================================================================

-- ── Domaines de valeurs ─────────────────────────────────────────────────────────────────────
-- `status` et `sender_role` étaient de simples colonnes texte : « status = 'banana' » était accepté,
-- et l'écran l'affichait comme « en cours » (tout ce qui n'est pas 'closed' l'est).
UPDATE public.support_requests SET status = 'open' WHERE status NOT IN ('open', 'closed');
UPDATE public.support_messages SET sender_role = 'user' WHERE sender_role NOT IN ('user', 'admin');

ALTER TABLE public.support_requests DROP CONSTRAINT IF EXISTS support_requests_status_chk;
ALTER TABLE public.support_requests ADD CONSTRAINT support_requests_status_chk
  CHECK (status IN ('open', 'closed'));

ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_messages_role_chk;
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_role_chk
  CHECK (sender_role IN ('user', 'admin'));

-- `last_message_at` sert au classement des deux listes : une valeur nulle faisait planter le tri
-- côté application (`localeCompare` sur null) et s'affichait comme une date de 1970.
UPDATE public.support_requests SET last_message_at = COALESCE(last_message_at, created_at, now())
  WHERE last_message_at IS NULL;
ALTER TABLE public.support_requests ALTER COLUMN last_message_at SET DEFAULT now();
ALTER TABLE public.support_requests ALTER COLUMN last_message_at SET NOT NULL;
UPDATE public.support_requests SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.support_requests ALTER COLUMN created_at SET NOT NULL;

-- ── Limites ─────────────────────────────────────────────────────────────────────────────────
-- Bornes larges : elles n'existent pas pour gêner quelqu'un qui décrit son problème en détail, mais
-- pour empêcher qu'on stocke un livre — ou dix mille demandes — dans une table lue par l'équipe.
CREATE OR REPLACE FUNCTION public.support_max_body() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 5000 $$;
CREATE OR REPLACE FUNCTION public.support_max_subject() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 150 $$;
CREATE OR REPLACE FUNCTION public.support_max_per_day() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- ── Messages : le rôle et l'auteur viennent du SERVEUR ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_message_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_body text;
BEGIN
  v_body := btrim(COALESCE(NEW.body, ''));
  IF v_body = '' THEN
    RAISE EXCEPTION 'Le message est vide.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_body) > public.support_max_body() THEN
    RAISE EXCEPTION 'Message trop long (% caractères, maximum %).', length(v_body), public.support_max_body()
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.body := v_body;

  -- Écriture SERVEUR (clé de service, console SQL) : aucun utilisateur derrière la requête, on ne
  -- présume rien et on laisse la valeur fournie.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- L'appelant ne CHOISIT pas son rôle : on le déduit de son compte.
  NEW.sender_role := CASE WHEN public.is_app_admin() THEN 'admin' ELSE 'user' END;
  NEW.author_id := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_before_insert_trg ON public.support_messages;
CREATE TRIGGER support_message_before_insert_trg
  BEFORE INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_message_before_insert();

-- ── La demande suit son fil, toute seule ────────────────────────────────────────────────────
-- Horodatage, réouverture et drapeau « non lu » du DESTINATAIRE : posés ici, à l'arrivée du
-- message. Le client faisait cette mise à jour lui-même, sans lire le résultat — quand la règle
-- d'accès la refusait, le message partait mais personne n'était prévenu.
CREATE OR REPLACE FUNCTION public.support_message_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Laissez-passer pour le déclencheur de protection ci-dessous : cette écriture-ci est la nôtre.
  PERFORM set_config('relyka.support_internal', '1', true);
  UPDATE public.support_requests
     SET last_message_at = now(),
         status          = 'open',
         admin_unread    = CASE WHEN NEW.sender_role = 'user'  THEN true ELSE admin_unread END,
         user_unread     = CASE WHEN NEW.sender_role = 'admin' THEN true ELSE user_unread  END
   WHERE id = NEW.request_id;
  PERFORM set_config('relyka.support_internal', '0', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_after_insert_trg ON public.support_messages;
CREATE TRIGGER support_message_after_insert_trg
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_message_after_insert();

-- ── Demandes : ce que l'auteur peut écrire, et ce qu'il ne peut pas ─────────────────────────
CREATE OR REPLACE FUNCTION public.support_request_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_subject text;
  v_today   int;
BEGIN
  -- Écriture serveur, ou administrateur : rien à protéger.
  IF auth.uid() IS NULL OR public.is_app_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_subject := btrim(COALESCE(NEW.subject, ''));
    IF v_subject = '' THEN v_subject := 'Demande d''assistance'; END IF;
    IF length(v_subject) > public.support_max_subject() THEN
      v_subject := left(v_subject, public.support_max_subject());
    END IF;

    SELECT count(*) INTO v_today
      FROM public.support_requests
     WHERE profile_id = auth.uid() AND created_at > now() - interval '24 hours';
    IF v_today >= public.support_max_per_day() THEN
      RAISE EXCEPTION 'Trop de demandes ouvertes en 24 h (maximum %). Réponds dans une demande existante.',
        public.support_max_per_day() USING ERRCODE = 'check_violation';
    END IF;

    -- L'identité de la demande vient du compte, pas du corps de la requête.
    NEW.profile_id      := auth.uid();
    NEW.profile_email   := (SELECT email FROM public.profiles WHERE id = auth.uid());
    NEW.subject         := v_subject;
    NEW.status          := 'open';
    NEW.admin_unread    := true;
    NEW.user_unread     := false;
    NEW.created_at      := now();
    NEW.last_message_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE. L'écriture faite par le déclencheur de message passe (c'est le serveur qui la produit).
  IF COALESCE(current_setting('relyka.support_internal', true), '0') = '1' THEN
    RETURN NEW;
  END IF;

  -- Colonnes d'identité et de classement : jamais modifiables par l'auteur.
  NEW.profile_id      := OLD.profile_id;
  NEW.profile_email   := OLD.profile_email;
  NEW.subject         := OLD.subject;
  NEW.created_at      := OLD.created_at;
  NEW.last_message_at := OLD.last_message_at;
  -- « Non lu par l'équipe » ne se retire pas depuis le téléphone : ce serait faire disparaître sa
  -- propre demande du tableau de bord de l'assistance. L'auteur peut le poser (nouveau message),
  -- pas l'effacer.
  IF OLD.admin_unread AND NOT COALESCE(NEW.admin_unread, false) THEN
    NEW.admin_unread := OLD.admin_unread;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_request_before_write_trg ON public.support_requests;
CREATE TRIGGER support_request_before_write_trg
  BEFORE INSERT OR UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.support_request_before_write();

-- ── Créer une demande = UNE opération ───────────────────────────────────────────────────────
-- Le client enchaînait deux écritures : la demande, puis son premier message. Quand la seconde
-- échouait (réseau coupé au mauvais moment), il restait une demande SANS message — visible dans la
-- liste de l'utilisateur et dans celle de l'équipe, avec un fil vide que personne ne pouvait
-- expliquer. Ici, les deux tiennent dans la même transaction : soit tout existe, soit rien.
CREATE OR REPLACE FUNCTION public.create_support_request(p_subject text, p_body text)
RETURNS public.support_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.support_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Non connecté.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.support_requests (profile_id, subject)
  VALUES (auth.uid(), p_subject)
  RETURNING * INTO v_req;

  -- Le rôle et l'auteur sont posés par le déclencheur ; l'horodatage de la demande aussi.
  INSERT INTO public.support_messages (request_id, sender_role, body)
  VALUES (v_req.id, 'user', p_body);

  SELECT * INTO v_req FROM public.support_requests WHERE id = v_req.id;
  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_request(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_support_request(text, text) TO authenticated;

-- ── Boîte à idées : même faille, même correction ────────────────────────────────────────────
-- `suggestions` s'insère avec « chacun la sienne » et rien de plus. `admin_unread` et `status`
-- étaient donc choisis par l'auteur : une suggestion insérée avec `admin_unread = false` n'entrait
-- dans aucun compteur et n'était jamais lue ; insérée avec `status = 'closed'`, elle s'affichait
-- à son auteur comme « traitée » sans que personne ne l'ait vue.
UPDATE public.suggestions SET status = 'open' WHERE status NOT IN ('open', 'closed');
ALTER TABLE public.suggestions DROP CONSTRAINT IF EXISTS suggestions_status_chk;
ALTER TABLE public.suggestions ADD CONSTRAINT suggestions_status_chk CHECK (status IN ('open', 'closed'));

CREATE OR REPLACE FUNCTION public.suggestion_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_content text;
BEGIN
  IF auth.uid() IS NULL OR public.is_app_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_content := btrim(COALESCE(NEW.content, ''));
    IF v_content = '' THEN
      RAISE EXCEPTION 'La suggestion est vide.' USING ERRCODE = 'check_violation';
    END IF;
    IF length(v_content) > 2000 THEN
      RAISE EXCEPTION 'Suggestion trop longue (maximum 2000 caractères).' USING ERRCODE = 'check_violation';
    END IF;
    NEW.content      := v_content;
    NEW.profile_id   := auth.uid();
    NEW.status       := 'open';
    NEW.admin_unread := true;
    NEW.created_at   := now();
    RETURN NEW;
  END IF;

  -- La mise à jour est réservée aux administrateurs (migration 038) : ceci n'est qu'un filet.
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS suggestion_before_write_trg ON public.suggestions;
CREATE TRIGGER suggestion_before_write_trg
  BEFORE INSERT OR UPDATE ON public.suggestions
  FOR EACH ROW EXECUTE FUNCTION public.suggestion_before_write();

NOTIFY pgrst, 'reload schema';

-- ── Vérifications (à jouer connecté en tant qu'un utilisateur NON administrateur) ────────────
--   -- 1. Un message ne peut pas se faire passer pour l'assistance :
--   INSERT INTO support_messages (request_id, sender_role, body)
--   VALUES ('<une demande à moi>', 'admin', 'test');
--   SELECT sender_role FROM support_messages ORDER BY created_at DESC LIMIT 1;  -- doit rendre 'user'
--
--   -- 2. La demande ne se retire pas du tableau de bord de l'équipe :
--   UPDATE support_requests SET admin_unread = false, profile_email = 'autre@exemple.test'
--    WHERE id = '<une demande à moi>';
--   SELECT admin_unread, profile_email FROM support_requests WHERE id = '<une demande à moi>';
--   -- doit rendre : true, et l'adresse d'origine
