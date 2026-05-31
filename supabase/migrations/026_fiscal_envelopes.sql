-- ─────────────────────────────────────────────────────────────
-- 026 — Enveloppes fiscales des comptes d'investissement
-- ─────────────────────────────────────────────────────────────

-- Enveloppe fiscale par compte (utilisée pour la projection)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fiscal_envelope TEXT
  CHECK (fiscal_envelope IN ('pea', 'av', 'cto', 'autre'));

-- Taux de fiscalité par enveloppe (éditable par l'admin)
CREATE TABLE IF NOT EXISTS fiscal_envelope_rates (
  envelope    TEXT PRIMARY KEY CHECK (envelope IN ('pea', 'av', 'cto', 'autre')),
  label       TEXT NOT NULL,
  tax_rate    NUMERIC NOT NULL,   -- % de fiscalité sur la plus-value
  sort_order  INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id)
);

INSERT INTO fiscal_envelope_rates (envelope, label, tax_rate, sort_order) VALUES
  ('pea',   'PEA',                18.6, 0),
  ('av',    'Assurance-vie',      18.6, 1),
  ('cto',   'Compte-titres (CTO)', 31.4, 2),
  ('autre', 'Autre',              31.4, 3)
ON CONFLICT (envelope) DO NOTHING;

ALTER TABLE fiscal_envelope_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_fiscal_rates"
  ON fiscal_envelope_rates FOR SELECT USING (true);

CREATE POLICY "authenticated_write_fiscal_rates"
  ON fiscal_envelope_rates FOR ALL USING (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
