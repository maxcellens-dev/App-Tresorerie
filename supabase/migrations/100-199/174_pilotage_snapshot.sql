-- Migration 174 : pilotage_snapshot() — TOUTES les données du tableau de bord en UN aller-retour.
--
-- CE QUE CETTE FONCTION N'EST PAS
-- ────────────────────────────────
-- Ce n'est PAS un portage du moteur Pilotage en SQL. Le moteur (≈1 300 lignes de TypeScript :
-- périmètre, ancres de régularisation, % d'impact des comptes partagés, mensualités de crédit,
-- enveloppe variable, projections 12 mois, calibration du doute…) reste la SEULE source de vérité.
-- Le réécrire ici en donnerait une deuxième version, et l'app a déjà payé plusieurs fois le prix de
-- deux implémentations de la même règle qui finissent par diverger.
--
-- CE QU'ELLE EST
-- ──────────────
-- Le RAPATRIEMENT des entrées de ce moteur, regroupé. Le client enchaînait onze requêtes réparties
-- en quatre vagues séquentielles (les dix du tableau de bord, puis la contribution des comptes
-- partagés, qui en enchaîne trois). Sur mobile, chaque vague coûte un aller-retour complet : c'est
-- de la latence pure, pas du calcul. Ici les mêmes lignes sont assemblées côté serveur, où elles
-- coûtent des millisecondes, et repartent en une seule réponse.
--
-- Les jeux de colonnes reproduisent EXACTEMENT ceux des requêtes du client (`to_jsonb` là où il
-- demandait `*`, donc rien à maintenir en double quand une colonne apparaît).
--
-- SÉCURITÉ : volontairement SECURITY INVOKER (le défaut). La fonction s'exécute avec les droits de
-- l'appelant, donc les RLS de chaque table s'appliquent EXACTEMENT comme aujourd'hui — y compris
-- pour un admin en consultation. Surtout pas SECURITY DEFINER : ce serait ouvrir un tuyau capable
-- de rendre les données de n'importe quel profil à qui passerait son identifiant.
--
-- `p_hist_start` est calculé par le CLIENT (1er jour du mois − 7, en heure LOCALE) et non ici :
-- le serveur est en UTC, et une borne de mois décalée d'un jour ferait entrer ou sortir des
-- transactions de la fenêtre selon le fuseau de l'utilisateur.

CREATE OR REPLACE FUNCTION public.pilotage_snapshot(p_profile uuid, p_hist_start date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
-- Noms de tables non qualifiés dans le corps : on fige le schéma plutôt que d'hériter du
-- search_path de l'appelant. (Sans effet sur les RLS, qui restent celles de l'appelant.)
SET search_path = public
AS $$
DECLARE
  v_shared_ids uuid[];
BEGIN
  -- Comptes PARTAGÉS auxquels je participe : les joints que je possède + ceux où je suis membre
  -- (hors les miens). Même ensemble que fetchSharedContribution, en une passe.
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_shared_ids
  FROM (
    SELECT a.id
      FROM accounts a
     WHERE a.profile_id = p_profile AND a.is_joint = true AND a.is_active = true
    UNION
    SELECT a.id
      FROM accounts a
      JOIN account_members m ON m.account_id = a.id
     WHERE m.user_id = p_profile AND a.is_active = true AND a.profile_id <> p_profile
  ) s;

  RETURN jsonb_build_object(
    'profile', (SELECT to_jsonb(p) FROM profiles p WHERE p.id = p_profile),

    'accounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        FROM accounts a WHERE a.profile_id = p_profile
    ),

    -- Fenêtre glissante + TOUS les modèles récurrents (quelle que soit leur date de départ).
    'transactions', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(t) || jsonb_build_object(
                 'account',  (SELECT jsonb_build_object('name', a.name)
                                FROM accounts a WHERE a.id = t.account_id),
                 'category', (SELECT jsonb_build_object(
                                'id', c.id, 'name', c.name, 'type', c.type,
                                'is_variable', c.is_variable, 'parent_id', c.parent_id)
                                FROM categories c WHERE c.id = t.category_id)
               )), '[]'::jsonb)
        FROM transactions t
       WHERE t.profile_id = p_profile
         AND (t.date >= p_hist_start OR t.is_recurring = true)
    ),

    'projects', (
      SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
        FROM projects pr WHERE pr.profile_id = p_profile
    ),

    'questionnaire', (
      SELECT to_jsonb(q) FROM user_questionnaire_answers q WHERE q.user_id = p_profile
    ),

    'rates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', r.code, 'rate', r.rate)), '[]'::jsonb)
        FROM currency_rates r
    ),

    'overrides', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'transaction_id', o.transaction_id, 'year', o.year,
               'month', o.month, 'override_amount', o.override_amount)), '[]'::jsonb)
        FROM transaction_month_overrides o WHERE o.profile_id = p_profile
    ),

    'credits', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(cr) || jsonb_build_object(
                 'category', (SELECT jsonb_build_object('id', c.id, 'name', c.name,
                                'is_variable', c.is_variable, 'parent_id', c.parent_id)
                                FROM categories c WHERE c.id = cr.category_id),
                 'insurance_category', (SELECT jsonb_build_object('id', c.id, 'name', c.name,
                                'is_variable', c.is_variable, 'parent_id', c.parent_id)
                                FROM categories c WHERE c.id = cr.insurance_category_id)
               )), '[]'::jsonb)
        FROM credits cr WHERE cr.profile_id = p_profile
    ),

    'credit_events', (
      SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
        FROM credit_events e WHERE e.profile_id = p_profile
    ),

    'closures', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('month_key', mc.month_key, 'status', mc.status)), '[]'::jsonb)
        FROM month_closures mc WHERE mc.profile_id = p_profile
    ),

    -- ── Comptes partagés : lignes BRUTES. La pondération par le % d'impact reste en TypeScript
    --    (hooks/useSharedContribution.buildSharedContribution) — une seule écriture de la règle.
    'shared_accounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        FROM accounts a WHERE a.id = ANY(v_shared_ids)
    ),
    'shared_members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'account_id', m.account_id, 'user_id', m.user_id,
               'impact_pct', m.impact_pct, 'shared_mode', m.shared_mode)), '[]'::jsonb)
        FROM account_members m WHERE m.account_id = ANY(v_shared_ids)
    ),
    'shared_transactions', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(t) || jsonb_build_object(
                 'account',  (SELECT jsonb_build_object('name', a.name, 'currency', a.currency,
                                'is_joint', a.is_joint, 'profile_id', a.profile_id)
                                FROM accounts a WHERE a.id = t.account_id),
                 'category', (SELECT to_jsonb(c) FROM categories c WHERE c.id = t.category_id)
               )), '[]'::jsonb)
        FROM transactions t WHERE t.account_id = ANY(v_shared_ids)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pilotage_snapshot(uuid, date) TO authenticated;

-- ── VÉRIFICATION APRÈS DÉPLOIEMENT ───────────────────────────────────────────────────────────────
-- Le client se replie SILENCIEUSEMENT sur les onze requêtes si une clé manque (garde de forme dans
-- hooks/usePilotageData) : l'app ne cassera pas, mais elle n'ira pas plus vite non plus. À lancer
-- une fois dans l'éditeur SQL, avec un vrai identifiant de profil, pour confirmer que le RPC répond
-- ET que ses volumes correspondent à ceux des requêtes qu'il remplace :
--
--   SELECT k, jsonb_typeof(v) AS type,
--          CASE WHEN jsonb_typeof(v) = 'array' THEN jsonb_array_length(v) END AS lignes
--     FROM jsonb_each(public.pilotage_snapshot('<profil-uuid>', date_trunc('month', now())::date - interval '7 months'))
--          AS t(k, v)
--    ORDER BY k;
--
-- Les treize clés doivent être présentes ; `profile` et `questionnaire` sont des objets (ou null
-- pour le second), tout le reste des tableaux. Comparer `transactions` au compte attendu :
--   SELECT count(*) FROM transactions
--    WHERE profile_id = '<profil-uuid>'
--      AND (date >= (date_trunc('month', now())::date - interval '7 months') OR is_recurring);
