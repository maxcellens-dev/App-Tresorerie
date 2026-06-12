-- Notifications : préférence utilisateur + jetons push (Expo) + notifications manuelles admin
-- + drapeau « non lu » sur les suggestions (badge admin = assistance + idées).

-- ── Préférence : notifications activées (toggle dans Paramètres) ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- ── Jetons push Expo (un par appareil) ──
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,                          -- 'ios' | 'android'
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON push_tokens(profile_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- L'utilisateur gère ses propres jetons ; l'admin peut tous les lire (pour l'envoi).
DROP POLICY IF EXISTS "push_tokens_select" ON push_tokens;
CREATE POLICY "push_tokens_select" ON push_tokens FOR SELECT TO authenticated
  USING (
    auth.uid() = profile_id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "push_tokens_insert" ON push_tokens;
CREATE POLICY "push_tokens_insert" ON push_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "push_tokens_update" ON push_tokens;
CREATE POLICY "push_tokens_update" ON push_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "push_tokens_delete" ON push_tokens;
CREATE POLICY "push_tokens_delete" ON push_tokens FOR DELETE TO authenticated
  USING (auth.uid() = profile_id);

-- ── Notifications manuelles (admin) : historique des envois ──
CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,  -- nombre d'appareils ciblés à l'envoi
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notifications_all" ON admin_notifications;
CREATE POLICY "admin_notifications_all" ON admin_notifications FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- ── Boîte à idées : drapeau « non lu » côté admin ──
-- Les suggestions existantes sont considérées lues ; les nouvelles arrivent non lues.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS admin_unread BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE suggestions ALTER COLUMN admin_unread SET DEFAULT true;
