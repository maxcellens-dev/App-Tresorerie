-- Migration 048 : Gamification (streak, gemmes, succès/badges, inventaire) + stockage icônes
--
-- Données par utilisateur. La CONFIG (définition des badges, libellés, icônes, seuils,
-- récompenses, boutique, identité) vit dans app_config.gamification (éditée en admin),
-- donc pas de table de config ici.

-- Config de gamification (badges, identité, série, boutique) éditée en admin
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS gamification JSONB;

-- État de gamification par utilisateur
CREATE TABLE IF NOT EXISTS user_gamification (
  profile_id        UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  streak            INT NOT NULL DEFAULT 0,
  best_streak       INT NOT NULL DEFAULT 0,
  last_validated_week DATE,           -- lundi de la dernière semaine validée
  freezes           INT NOT NULL DEFAULT 0,
  gems              INT NOT NULL DEFAULT 0,   -- solde dépensable
  gems_earned_total INT NOT NULL DEFAULT 0,   -- cumul gagné (pour les paliers)
  tier              TEXT NOT NULL DEFAULT 'bronze',
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Succès débloqués (1 ligne par badge, niveau le plus haut atteint)
CREATE TABLE IF NOT EXISTS user_badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_key   TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'bronze',   -- bronze | silver | gold
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, badge_key)
);

-- Inventaire (thèmes débloqués, gels achetés, bons…)
CREATE TABLE IF NOT EXISTS user_inventory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL,
  qty        INT NOT NULL DEFAULT 1,
  acquired_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_profile ON user_badges(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_profile ON user_inventory(profile_id);

-- ── RLS : chacun gère ses propres lignes ──
ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gam_self" ON user_gamification;
CREATE POLICY "gam_self" ON user_gamification FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "badges_self" ON user_badges;
CREATE POLICY "badges_self" ON user_badges FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "inventory_self" ON user_inventory;
CREATE POLICY "inventory_self" ON user_inventory FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- ── Stockage des icônes/images de badges (bucket public, écriture admin) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('gamification', 'gamification', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "gamification_public_read" ON storage.objects;
CREATE POLICY "gamification_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'gamification');

DROP POLICY IF EXISTS "gamification_admin_write" ON storage.objects;
CREATE POLICY "gamification_admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gamification' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "gamification_admin_update" ON storage.objects;
CREATE POLICY "gamification_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'gamification' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (bucket_id = 'gamification' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "gamification_admin_delete" ON storage.objects;
CREATE POLICY "gamification_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'gamification' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
