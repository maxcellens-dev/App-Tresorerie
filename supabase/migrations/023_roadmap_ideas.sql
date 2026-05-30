-- ─────────────────────────────────────────────────────────────
-- 023 — Idées en cours de développement (alimentées par l'admin)
-- ─────────────────────────────────────────────────────────────
-- Affichées dans la "Boîte à idées" côté utilisateur.
-- Si la table est vide, la section n'apparaît pas.

CREATE TABLE IF NOT EXISTS roadmap_ideas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  icon        TEXT DEFAULT 'construct-outline',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE roadmap_ideas ENABLE ROW LEVEL SECURITY;

-- Lecture publique (tous les utilisateurs authentifiés)
CREATE POLICY "public_read_roadmap_ideas"
  ON roadmap_ideas FOR SELECT USING (true);

-- Écriture réservée aux authentifiés (contrôle admin au niveau applicatif)
CREATE POLICY "authenticated_write_roadmap_ideas"
  ON roadmap_ideas FOR ALL USING (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
