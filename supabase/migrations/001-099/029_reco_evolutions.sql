-- ─────────────────────────────────────────────────────────────
-- 029 — Évolutions du système de recommandations
--   • pré-épargne / pré-investissement (cumuls « mentaux »)
--   • réservations « Conserver pour plus tard »
--   • seuils de recommandations (éditables admin)
-- ─────────────────────────────────────────────────────────────

-- ── Pré-épargne / pré-invest : 1 ligne par utilisateur par type ──
CREATE TABLE IF NOT EXISTS pre_savings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('epargne', 'invest')),
  total_cumule NUMERIC(14, 2) NOT NULL DEFAULT 0,
  entrees      JSONB NOT NULL DEFAULT '[]',          -- [{ date, montant, note }]
  statut       TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'en_depassement')),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, type)
);

ALTER TABLE pre_savings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own pre_savings"
  ON pre_savings FOR ALL
  USING (auth.uid() = profile_id);
CREATE INDEX IF NOT EXISTS idx_pre_savings_profile ON pre_savings(profile_id);

-- ── Réservations « Conserver pour plus tard » ──
CREATE TABLE IF NOT EXISTS reservations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  montant     NUMERIC(14, 2) NOT NULL,
  libelle     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  libere_at   TIMESTAMPTZ
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own reservations"
  ON reservations FOR ALL
  USING (auth.uid() = profile_id);
CREATE INDEX IF NOT EXISTS idx_reservations_profile ON reservations(profile_id);

-- ── Seuils de recommandations (singleton, éditable admin) ──
CREATE TABLE IF NOT EXISTS recommendation_settings (
  id                 TEXT PRIMARY KEY DEFAULT 'default',
  seuil_reco_epargne NUMERIC NOT NULL DEFAULT 50,   -- € de reste min pour la reco épargne
  seuil_reco_invest  NUMERIC NOT NULL DEFAULT 100,  -- € de reste min pour la reco invest
  seuil_reco_plaisir NUMERIC NOT NULL DEFAULT 50,   -- € de reste min pour la reco plaisir
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_by         UUID REFERENCES auth.users(id)
);

INSERT INTO recommendation_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

ALTER TABLE recommendation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_reco_settings"
  ON recommendation_settings FOR SELECT USING (true);
CREATE POLICY "authenticated_write_reco_settings"
  ON recommendation_settings FOR ALL USING (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
