-- ─────────────────────────────────────────────────────────────
-- 027 — Notes explicatives éditables par enveloppe fiscale
-- ─────────────────────────────────────────────────────────────

ALTER TABLE fiscal_envelope_rates ADD COLUMN IF NOT EXISTS note TEXT;

UPDATE fiscal_envelope_rates SET note =
  'Taux après 5 ans de détention. Un retrait avant 5 ans est taxé à ~30 % — ajustez le % pour une projection courte.'
  WHERE envelope = 'pea';
UPDATE fiscal_envelope_rates SET note =
  'Taux après 8 ans de détention. Avant, la fiscalité est plus élevée — ajustez le % si besoin.'
  WHERE envelope = 'av';
UPDATE fiscal_envelope_rates SET note =
  'Flat tax (PFU) de 30 % sur les plus-values, sans condition de durée.'
  WHERE envelope = 'cto';
UPDATE fiscal_envelope_rates SET note =
  'Taux appliqué par défaut. Ajustez-le selon votre situation.'
  WHERE envelope = 'autre';

NOTIFY pgrst, 'reload schema';
