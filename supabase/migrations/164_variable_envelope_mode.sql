-- ============================================================================
-- 164 — Dépenses variables : l'utilisateur choisit sa référence.
--
-- L'enveloppe variable était décidée par l'app seule : moyenne réelle dès 2 mois d'historique
-- exploitables, sinon estimation déclarée au questionnaire. Aucun moyen de dire « garde mon
-- estimation, mon historique n'est pas représentatif » — ni l'inverse.
--
--   'auto'     : comportement historique (réel dès qu'il est disponible, sinon estimation). DÉFAUT,
--                donc rien ne change pour les comptes existants.
--   'estimate' : force l'estimation déclarée (weekly_variable_budget × semaines).
--   'real'     : force la moyenne réelle observée ; si l'historique est insuffisant, l'app retombe
--                sur l'estimation (on ne fabrique pas une moyenne sur un seul mois).
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS variable_envelope_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (variable_envelope_mode IN ('auto', 'estimate', 'real'));

COMMENT ON COLUMN public.profiles.variable_envelope_mode IS
  'Référence des dépenses variables : auto (défaut) | estimate (déclaré) | real (moyenne observée).';

NOTIFY pgrst, 'reload schema';
