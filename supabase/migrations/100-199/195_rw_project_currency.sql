-- 195 — Relyka World : devise du PROJET choisie à la création.
--
-- `rw_projects.currency` et `rw_expenses.currency` existent depuis la migration 069, mais rien ne
-- les a jamais renseignés : tout restait sur le défaut 'EUR', y compris pour un utilisateur dont la
-- devise de référence est le CHF ou le dollar.
--
-- Modèle retenu (cf. lib/finance/currency) :
--   • le PROJET porte une devise — c'est celle dans laquelle se lisent tous ses totaux (soldes
--     entre participants, « qui doit quoi », récapitulatif par compte) ;
--   • une DÉPENSE est libellée dans la devise où elle a réellement été payée : celle du compte
--     utilisé quand il y en a un, celle du projet sinon (cash). Ses lignes de répartition
--     (rw_expense_shares) et d'avance (rw_expense_payers) sont dans CETTE devise ;
--   • l'affichage convertit dépense → projet au taux courant (table currency_rates, base EUR).
--
-- Une dépense est donc atomique : un seul montant, une seule devise, et aucune conversion écrite
-- en base — les taux bougent, seuls les faits saisis sont stockés.

-- ── Création de projet : nouvelle signature avec devise ────────────────────────────────────────
-- L'ancienne signature à 4 arguments est CONSERVÉE : une mise à jour OTA se déploie
-- progressivement, et un client encore à l'ancienne version doit continuer de créer des projets
-- (il retombe alors sur la devise par défaut). PostgREST distingue les deux par leurs arguments.
CREATE OR REPLACE FUNCTION public.rw_create_project(
  p_name text, p_emoji text, p_desc text, p_myname text, p_currency text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; pid uuid; cur text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Nom requis'; END IF;

  -- Code ISO 4217 : 3 lettres, toujours en majuscules. Une valeur absente ou fantaisiste retombe
  -- sur EUR plutôt que d'écrire une devise que rien ne saura convertir.
  cur := upper(coalesce(nullif(trim(p_currency), ''), 'EUR'));
  IF cur !~ '^[A-Z]{3}$' THEN cur := 'EUR'; END IF;

  INSERT INTO public.rw_projects(owner_id, name, emoji, description, currency)
    VALUES (uid, trim(p_name), coalesce(nullif(p_emoji, ''), '💸'), coalesce(p_desc, ''), cur)
    RETURNING id INTO pid;
  INSERT INTO public.rw_participants(project_id, user_id, display_name)
    VALUES (pid, uid, coalesce(nullif(trim(p_myname), ''), 'Moi'));
  RETURN pid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rw_create_project(text, text, text, text, text) TO authenticated;

-- ── Garde-fou : une devise stockée est toujours un code ISO exploitable ────────────────────────
-- Sans cette contrainte, un client buggé pourrait écrire 'eur' ou '€' — et la conversion, qui
-- cherche le code dans currency_rates, renverrait NULL sans que rien ne le signale.
ALTER TABLE public.rw_projects
  DROP CONSTRAINT IF EXISTS rw_projects_currency_iso;
ALTER TABLE public.rw_projects
  ADD CONSTRAINT rw_projects_currency_iso CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.rw_expenses
  DROP CONSTRAINT IF EXISTS rw_expenses_currency_iso;
ALTER TABLE public.rw_expenses
  ADD CONSTRAINT rw_expenses_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
