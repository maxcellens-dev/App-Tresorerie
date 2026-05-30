-- ─────────────────────────────────────────────────────────────
-- 020 — Système de profils financiers
-- ─────────────────────────────────────────────────────────────

-- Indicateur de complétion du questionnaire dans la table profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS financial_profile_questionnaire_completed BOOLEAN DEFAULT FALSE;

-- ── Tables principales ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_financial_profile (
  user_id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id                   TEXT NOT NULL CHECK (profile_id IN ('P1','P2','P3','P4','P5')),
  profile_source               TEXT NOT NULL DEFAULT 'questionnaire'
                                 CHECK (profile_source IN ('questionnaire','automatic')),
  assigned_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_unlock_at               TIMESTAMPTZ,
  is_irregular_income          BOOLEAN DEFAULT FALSE,
  consecutive_upgrade_months   INTEGER DEFAULT 0,
  consecutive_downgrade_months INTEGER DEFAULT 0,
  last_auto_evaluation         DATE,
  created_at                   TIMESTAMPTZ DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_questionnaire_answers (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  q1          TEXT,
  q2          TEXT,
  q3          TEXT,
  q4          TEXT,
  q5          TEXT,
  q6          TEXT,
  q7          TEXT,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_change_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_profile TEXT,
  new_profile      TEXT NOT NULL,
  change_reason    TEXT NOT NULL
    CHECK (change_reason IN (
      'questionnaire_update','automatic_upgrade',
      'automatic_downgrade','exceptional_revenue_drop'
    )),
  triggered_at       TIMESTAMPTZ DEFAULT NOW(),
  notification_shown BOOLEAN DEFAULT FALSE
);

-- ── Tables admin ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profile_matrix_config (
  transition                      TEXT PRIMARY KEY,
  upgrade_months_threshold        NUMERIC NOT NULL,
  upgrade_flux_threshold          NUMERIC NOT NULL,
  downgrade_months_threshold      NUMERIC NOT NULL,
  downgrade_flux_threshold        NUMERIC NOT NULL,
  anti_yoyo_months                INTEGER NOT NULL DEFAULT 2,
  exceptional_drop_threshold_pct  NUMERIC DEFAULT 50,
  exceptional_drop_months         INTEGER DEFAULT 2,
  irregular_drop_threshold_pct    NUMERIC DEFAULT 20,
  auto_eval_enabled               BOOLEAN DEFAULT TRUE,
  freeze_months                   INTEGER DEFAULT 6,
  flux_window_months              INTEGER DEFAULT 3,
  expenses_window_months          INTEGER DEFAULT 6,
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_by                      UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS profile_notification_messages (
  transition  TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('upgrade','downgrade','exceptional')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id),
  PRIMARY KEY (transition, direction)
);

-- ── Seed profile_matrix_config ────────────────────────────────

INSERT INTO profile_matrix_config (
  transition,
  upgrade_months_threshold, upgrade_flux_threshold,
  downgrade_months_threshold, downgrade_flux_threshold,
  anti_yoyo_months
) VALUES
  ('P1_P2',  1,  5,  0.5,  0, 2),
  ('P2_P3',  3, 10,  2,    5, 2),
  ('P3_P4',  6, 15,  5,   10, 2),
  ('P4_P5', 12, 20, 10,   10, 2)
ON CONFLICT (transition) DO NOTHING;

-- ── Seed profile_notification_messages ───────────────────────

INSERT INTO profile_notification_messages (transition, direction, title, body) VALUES
  ('P1_P2', 'upgrade',
   '🌿 Vous passez au profil "Réserve à construire"',
   'Votre matelas de sécurité commence à se constituer. C''est une vraie avancée — vous avez maintenant un filet de protection en cas d''imprévu. L''objectif du moment : continuer sur cette lancée et atteindre 3 mois de réserve.'),

  ('P2_P3', 'upgrade',
   '⚖️ Vous passez au profil "Stabilité à améliorer"',
   'Votre base financière est solide. Vous avez constitué une réserve de sécurité réelle et votre comportement d''épargne est régulier. Il est maintenant temps de commencer à faire travailler votre argent au-delà de l''épargne pure.'),

  ('P3_P4', 'upgrade',
   '🚀 Vous passez au profil "Bonne dynamique"',
   'Excellent travail. Votre réserve de sécurité est confortable et vous épargnez ou investissez régulièrement. Vous entrez dans une phase où l''investissement prend une place plus importante pour faire croître votre patrimoine.'),

  ('P4_P5', 'upgrade',
   '🎯 Vous passez au profil "Patrimoine en développement"',
   'Vous avez atteint un niveau de maturité financière remarquable. Votre réserve de sécurité est très solide et vous investissez de manière significative. La priorité est maintenant d''optimiser et de faire croître votre patrimoine.'),

  ('P2_P1', 'downgrade',
   '🌱 Votre profil évolue vers "Premiers repères"',
   'Votre réserve de sécurité s''est réduite ou votre épargne est à l''arrêt depuis quelques mois. Pas d''inquiétude — l''application adapte ses recommandations pour vous aider à reconstruire une base stable en priorité.'),

  ('P3_P2', 'downgrade',
   '🌿 Votre profil évolue vers "Réserve à construire"',
   'Votre situation financière a évolué ces dernières semaines. Votre réserve de sécurité est en dessous du seuil recommandé. L''objectif du moment est de la reconstituer avant de reprendre une stratégie d''investissement.'),

  ('P4_P3', 'downgrade',
   '⚖️ Votre profil évolue vers "Stabilité à améliorer"',
   'Votre réserve de sécurité ou votre niveau d''épargne a baissé. Votre profil s''ajuste temporairement pour sécuriser votre situation. Dès que votre réserve remonte, vous retrouverez votre niveau précédent.'),

  ('P5_P4', 'downgrade',
   '🚀 Votre profil évolue vers "Bonne dynamique"',
   'Votre réserve ou votre flux d''investissement est passé en dessous du seuil du profil précédent. Vos recommandations s''adaptent en conséquence. Rien d''alarmant — une légère réorientation suffit pour retrouver votre niveau.'),

  ('exceptional_one', 'exceptional',
   '⚠️ Votre profil a été ajusté suite à une baisse de revenus',
   'Vos revenus des 2 derniers mois sont significativement inférieurs à votre moyenne habituelle. Votre profil a été ajusté d''un niveau pour adapter les recommandations à votre situation actuelle. L''application passe en mode "protection" le temps que votre situation se stabilise.'),

  ('exceptional_two', 'exceptional',
   '⚠️ Votre profil a été ajusté — aucun revenu détecté',
   'Aucun revenu n''a été enregistré ces 2 derniers mois. Votre profil a été ajusté de deux niveaux pour vous proposer des recommandations adaptées à cette période. L''objectif est de préserver votre épargne disponible au maximum.')

ON CONFLICT (transition, direction) DO NOTHING;

-- ── Mise à jour des allocations de palier pour aligner sur P1-P5 ──

-- P2 = below_optimal : invest 15→10, keep 25→30
UPDATE recommendation_tier_allocations SET value = 10  WHERE tier = 'below_optimal' AND type = 'invest';
UPDATE recommendation_tier_allocations SET value = 30  WHERE tier = 'below_optimal' AND type = 'keep';

-- P3 = healthy : save 20→25, invest 30→25, enjoy 25→20, keep 25→30
UPDATE recommendation_tier_allocations SET value = 25  WHERE tier = 'healthy' AND type = 'save';
UPDATE recommendation_tier_allocations SET value = 25  WHERE tier = 'healthy' AND type = 'invest';
UPDATE recommendation_tier_allocations SET value = 20  WHERE tier = 'healthy' AND type = 'enjoy';
UPDATE recommendation_tier_allocations SET value = 30  WHERE tier = 'healthy' AND type = 'keep';

-- P5 = comfortable : save 15→0, invest 40→65, enjoy 25→25, keep 20→10
UPDATE recommendation_tier_allocations SET value = 0   WHERE tier = 'comfortable' AND type = 'save';
UPDATE recommendation_tier_allocations SET value = 65  WHERE tier = 'comfortable' AND type = 'invest';
UPDATE recommendation_tier_allocations SET value = 10  WHERE tier = 'comfortable' AND type = 'keep';

-- P4 = nouveau palier "Bonne dynamique"
INSERT INTO recommendation_tier_allocations (tier, type, value) VALUES
  ('p4_dynamic', 'save',    10),
  ('p4_dynamic', 'invest',  40),
  ('p4_dynamic', 'enjoy',   25),
  ('p4_dynamic', 'keep',    25)
ON CONFLICT (tier, type) DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE user_financial_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_questionnaire_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_matrix_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_notification_messages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_financial_profile"
  ON user_financial_profile FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_questionnaire_answers"
  ON user_questionnaire_answers FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_profile_change_log"
  ON profile_change_log FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "public_read_matrix_config"
  ON profile_matrix_config FOR SELECT USING (true);

CREATE POLICY "authenticated_write_matrix_config"
  ON profile_matrix_config FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "public_read_notification_messages"
  ON profile_notification_messages FOR SELECT USING (true);

CREATE POLICY "authenticated_write_notification_messages"
  ON profile_notification_messages FOR ALL USING (auth.role() = 'authenticated');
