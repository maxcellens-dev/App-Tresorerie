-- ============================================================
-- Transaction Month Overrides: surcharge ponctuelle pour un mois spécifique
-- ============================================================

-- Permet de modifier le montant d'une transaction récurrente pour un mois donné
-- Ex: "Salaire" = 3000€/mois, mais décembre 2025 = 3500€ (13ème mois)
CREATE TABLE IF NOT EXISTS transaction_month_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  override_amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  
  UNIQUE (transaction_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_overrides_profile ON transaction_month_overrides(profile_id);
CREATE INDEX IF NOT EXISTS idx_overrides_transaction ON transaction_month_overrides(transaction_id);
CREATE INDEX IF NOT EXISTS idx_overrides_month ON transaction_month_overrides(year, month);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_override_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_override_timestamp_trigger ON transaction_month_overrides;
CREATE TRIGGER update_override_timestamp_trigger
  BEFORE UPDATE ON transaction_month_overrides
  FOR EACH ROW EXECUTE PROCEDURE update_override_timestamp();
