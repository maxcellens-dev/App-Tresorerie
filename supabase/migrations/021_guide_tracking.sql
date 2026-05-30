-- ─────────────────────────────────────────────────────────────
-- 021 — Suivi des guides "première visite" (par écran)
-- ─────────────────────────────────────────────────────────────
-- Colonnes booléennes dans profiles pour pouvoir réinitialiser
-- manuellement un guide depuis le dashboard Supabase (passer à FALSE).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guide_comptes_seen      BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guide_transactions_seen BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guide_pilotage_seen     BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guide_tresorerie_seen   BOOLEAN DEFAULT FALSE;

-- Forcer PostgREST à recharger le cache de schéma immédiatement
NOTIFY pgrst, 'reload schema';
