-- Groupes d'utilisateurs (admin) + ciblage des notifications.
-- Premium / Normal existent déjà via profiles.is_premium ; ici on ajoute des groupes CUSTOM
-- (visibles seulement en admin) auxquels on affecte des utilisateurs, pour cibler les notifs.
-- (Plus tard : des groupes « dynamiques » selon des stats — non couvert ici, le schéma le permettra.)

-- ── Groupes custom ──
CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT,                              -- couleur d'affichage (optionnel)
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Appartenance (n-n) ──
CREATE TABLE IF NOT EXISTS user_group_members (
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_ugm_group ON user_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_ugm_profile ON user_group_members(profile_id);

ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;

-- Admin uniquement (CRUD). L'Edge Function utilise la SERVICE ROLE (bypass RLS).
DROP POLICY IF EXISTS "user_groups_admin" ON user_groups;
CREATE POLICY "user_groups_admin" ON user_groups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

DROP POLICY IF EXISTS "user_group_members_admin" ON user_group_members;
CREATE POLICY "user_group_members_admin" ON user_group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- ── Ciblage des notifications planifiées ──
-- target_kind : 'all' (défaut) | 'premium' | 'normal' | 'group' (avec target_group_id).
ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS target_kind TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_group_id UUID REFERENCES user_groups(id) ON DELETE SET NULL;

-- Trace lisible de la cible dans l'historique (ex. « Tous », « Premium », « Groupe : Beta »).
ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS target_label TEXT;
