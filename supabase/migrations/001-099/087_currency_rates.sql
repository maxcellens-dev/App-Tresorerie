-- Migration 087 : taux de change (fondation multi-devises).
--
-- Modèle : chaque COMPTE a une devise native (accounts.currency, déjà présent). Une transaction
-- est dans la devise de son compte. profiles.currency_code = devise de RÉFÉRENCE (affichage des
-- agrégats : Total liquidités, Pilotage…). La conversion utilise cette table.
--
-- Convention : `rate` = nombre d'unités de la devise pour 1 EUR (base = EUR, rate(EUR)=1).
--   Convertir `montant` de A vers B :  montant * rate(B) / rate(A).
-- Les taux sont indicatifs et rafraîchis quotidiennement (Phase 2) ; override admin possible.

CREATE TABLE IF NOT EXISTS currency_rates (
  code       TEXT PRIMARY KEY,          -- ISO 4217 (EUR, USD, CHF…)
  rate       NUMERIC(18,6) NOT NULL,    -- unités de `code` pour 1 EUR
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "currency_rates_select" ON currency_rates;
CREATE POLICY "currency_rates_select" ON currency_rates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "currency_rates_admin_write" ON currency_rates;
CREATE POLICY "currency_rates_admin_write" ON currency_rates FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Taux indicatifs initiaux (unités pour 1 EUR). Mis à jour ensuite par le rafraîchissement quotidien.
INSERT INTO currency_rates (code, rate) VALUES
  ('EUR', 1),        ('USD', 1.08),    ('GBP', 0.85),    ('CHF', 0.95),
  ('CAD', 1.47),     ('AUD', 1.65),    ('NZD', 1.78),    ('JPY', 162),
  ('CNY', 7.8),      ('SEK', 11.3),    ('NOK', 11.6),    ('DKK', 7.46),
  ('PLN', 4.3),      ('CZK', 25.2),    ('HUF', 392),     ('RON', 4.97),
  ('BGN', 1.96),     ('TRY', 35),      ('RUB', 100),     ('UAH', 44),
  ('INR', 90),       ('IDR', 17000),   ('KRW', 1450),    ('SGD', 1.45),
  ('HKD', 8.4),      ('TWD', 35),      ('THB', 38),      ('MYR', 5.1),
  ('PHP', 62),       ('VND', 27000),   ('BRL', 5.9),     ('MXN', 20),
  ('ARS', 1080),     ('CLP', 1030),    ('COP', 4500),    ('ZAR', 19.5),
  ('AED', 3.97),     ('SAR', 4.05),    ('MAD', 10.7),    ('TND', 3.4),
  ('XOF', 656),      ('XAF', 656)
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
