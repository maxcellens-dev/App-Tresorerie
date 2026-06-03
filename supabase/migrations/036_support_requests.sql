-- Assistance : demandes de support + fil de messages (échange utilisateur ⇄ admin)

CREATE TABLE IF NOT EXISTS support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_email TEXT,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',            -- 'open' | 'closed'
  user_unread BOOLEAN NOT NULL DEFAULT false,     -- réponse admin non lue par l'utilisateur
  admin_unread BOOLEAN NOT NULL DEFAULT true,     -- message utilisateur non lu par l'admin
  created_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,                      -- 'user' | 'admin'
  author_id UUID,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_request ON support_messages(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_requests_profile ON support_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status, last_message_at DESC);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- ── support_requests : l'utilisateur voit/écrit les siennes, l'admin voit/gère tout ──
DROP POLICY IF EXISTS "support_requests_select" ON support_requests;
CREATE POLICY "support_requests_select" ON support_requests FOR SELECT TO authenticated
  USING (
    auth.uid() = profile_id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "support_requests_insert" ON support_requests;
CREATE POLICY "support_requests_insert" ON support_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "support_requests_update" ON support_requests;
CREATE POLICY "support_requests_update" ON support_requests FOR UPDATE TO authenticated
  USING (
    auth.uid() = profile_id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin)
  );

-- ── support_messages : accès lié à l'accès de la demande parente ──
DROP POLICY IF EXISTS "support_messages_select" ON support_messages;
CREATE POLICY "support_messages_select" ON support_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_requests r
      WHERE r.id = request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
    )
  );

DROP POLICY IF EXISTS "support_messages_insert" ON support_messages;
CREATE POLICY "support_messages_insert" ON support_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_requests r
      WHERE r.id = request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
    )
  );
