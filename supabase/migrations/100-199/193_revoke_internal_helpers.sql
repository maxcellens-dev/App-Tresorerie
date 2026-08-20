-- ============================================================================
-- 193 — SÉCURITÉ : deux fonctions internes étaient appelables par n'importe qui.
--
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut sur toute fonction créée. Une fonction
-- `SECURITY DEFINER` sans `GRANT` explicite n'est donc pas « privée » : elle est ouverte à tous —
-- et PostgREST expose tout ce qui vit dans le schéma `public` en RPC. Une fonction qui s'appuie sur
-- son appelant pour contrôler les droits devient alors une porte dérobée vers ces droits.
--
-- Deux fonctions écrites en 189 et 191 sont dans ce cas. Elles sont conçues comme des SOUS-ROUTINES,
-- appelées depuis des fonctions qui, elles, vérifient les droits — mais rien n'empêchait de les
-- appeler directement :
--
--   • `rw_absorb_participant_lines(from, into)` — la plus grave. Elle DÉPLACE les dépenses avancées
--     et les quotes-parts d'un participant vers un autre, sans contrôle : `rw_remove_participant` et
--     `rw_merge_participants` vérifient le projet, le propriétaire et le garde-fou de l'argent réel
--     AVANT de l'appeler. Appelée en direct avec deux identifiants, elle réattribuait l'argent de
--     n'importe qui dans n'importe quel projet.
--
--   • `rw_participant_refs(participant)` — lecture seule, mais elle répond sur un participant
--     quelconque, sans vérifier l'accès au projet. Aucun écran n'en a besoin : elle ne sert qu'aux
--     garde-fous internes.
--
-- On retire donc l'exécution à tout le monde. Les fonctions qui les utilisent sont `SECURITY
-- DEFINER` : elles s'exécutent avec les droits du propriétaire, et continuent d'y accéder.
-- ============================================================================

REVOKE ALL ON FUNCTION public.rw_absorb_participant_lines(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rw_absorb_participant_lines(uuid, uuid) FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.rw_participant_refs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rw_participant_refs(uuid) FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
