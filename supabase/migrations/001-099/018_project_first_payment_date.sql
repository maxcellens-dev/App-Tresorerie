-- Store the effective first payment date on projects so it can be updated
-- when transactions are deleted/modified (e.g. recalculation in date-cible mode)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS first_payment_date DATE;
