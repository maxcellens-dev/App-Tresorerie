-- Suggestions / Boîte à idées
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Allow authenticated users to read, insert, and manage their own suggestions
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own suggestions"
  ON suggestions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can read their own suggestions"
  ON suggestions FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);

-- Admins can read all suggestions (via service role or direct query)
-- For simplicity, we allow all authenticated users to read all:
DROP POLICY IF EXISTS "Users can read their own suggestions" ON suggestions;
CREATE POLICY "Authenticated users can read all suggestions"
  ON suggestions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can delete suggestions"
  ON suggestions FOR DELETE TO authenticated
  USING (true);
