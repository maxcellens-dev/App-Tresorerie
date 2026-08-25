-- ============================================================================
-- 213 — SUPPRESSION DE COMPTE : LEVER LES DEUX RÉFÉRENCES QUI LA BLOQUENT.
--
-- ── Le symptôme ─────────────────────────────────────────────────────────────────────────────
-- « Supprimer mon compte » (Profil › Zone de danger) appelle `delete_own_account()`, qui finit par
-- `DELETE FROM auth.users`. Deux colonnes pointent vers cette table SANS règle de suppression —
-- donc en `NO ACTION`, le défaut de PostgreSQL :
--
--     roadmap_ideas.created_by     UUID REFERENCES auth.users(id)      (migration 023)
--     fiscal_envelope_rates.updated_by  UUID REFERENCES auth.users(id)      (migration 026)
--
-- Dès qu'un compte a créé une idée de feuille de route ou touché aux enveloppes fiscales, la
-- suppression échoue sur une violation de clé étrangère. L'écran affiche « Impossible de supprimer
-- le compte » et il n'existe AUCUN moyen de s'en sortir depuis l'application.
--
-- Les deux colonnes ne sont alimentées que par l'administration : ce sont donc les comptes
-- administrateurs qui ne pouvaient pas être supprimés. Le contenu, lui, n'a aucune raison de
-- disparaître avec son auteur — une idée de feuille de route reste valable quand la personne qui
-- l'a saisie s'en va. `SET NULL` est la bonne règle : on perd la signature, pas la ligne.
--
-- Rappel : la suppression de compte accessible depuis l'application est une EXIGENCE des deux
-- boutiques. Qu'elle échoue pour certains comptes est un défaut de conformité, pas seulement une
-- gêne.
-- ============================================================================

ALTER TABLE public.roadmap_ideas DROP CONSTRAINT IF EXISTS roadmap_ideas_created_by_fkey;
ALTER TABLE public.roadmap_ideas
  ADD CONSTRAINT roadmap_ideas_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.fiscal_envelope_rates DROP CONSTRAINT IF EXISTS fiscal_envelope_rates_updated_by_fkey;
ALTER TABLE public.fiscal_envelope_rates
  ADD CONSTRAINT fiscal_envelope_rates_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';

-- ── Vérification : plus aucune référence vers auth.users ne bloque une suppression ───────────
--   SELECT c.conrelid::regclass AS "table", a.attname AS colonne, c.confdeltype AS regle
--     FROM pg_constraint c
--     JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
--     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
--    WHERE c.contype = 'f'
--      AND c.confrelid = 'auth.users'::regclass
--      AND c.confdeltype = 'a';   -- 'a' = NO ACTION → doit ne rien rendre
