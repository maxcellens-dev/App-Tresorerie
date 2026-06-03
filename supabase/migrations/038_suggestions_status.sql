-- Suggestions : statut (ouverte / clôturée) pour l'archivage côté utilisateur
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

-- L'admin peut clôturer / rouvrir une suggestion.
DROP POLICY IF EXISTS "Admins can update suggestions" ON suggestions;
CREATE POLICY "Admins can update suggestions"
  ON suggestions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));
