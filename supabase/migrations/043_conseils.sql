-- Système de conseils financiers contextuels affichés dans le Pilotage.
-- Deux types : "general" (texte fixe, rotation quotidienne) et "contextuel" (critère + message).

CREATE TABLE IF NOT EXISTS conseils (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('general', 'contextuel')),
  -- Texte du conseil (variables {accolades} remplacées côté client pour "contextuel")
  message TEXT NOT NULL,
  -- Critère de déclenchement (code identifiant, null = toujours actif pour "general")
  critere_key TEXT,
  -- Ordre d'affichage / rotation pour les conseils généraux
  display_order INTEGER DEFAULT 0,
  -- Actif / inactif (admin peut désactiver sans supprimer)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Conseil affiché aujourd'hui par utilisateur (évite les répétitions dans la journée)
CREATE TABLE IF NOT EXISTS user_conseil_seen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conseil_id UUID NOT NULL REFERENCES conseils(id) ON DELETE CASCADE,
  seen_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- dismissed = fermé par l'utilisateur (croix)
  dismissed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (profile_id, conseil_id, seen_date)
);

CREATE INDEX IF NOT EXISTS idx_conseils_type ON conseils(type, active);
CREATE INDEX IF NOT EXISTS idx_user_conseil_seen ON user_conseil_seen(profile_id, seen_date);

-- RLS
ALTER TABLE conseils ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_conseil_seen ENABLE ROW LEVEL SECURITY;

-- Conseils : lecture pour tous les utilisateurs authentifiés, écriture admin seulement
DROP POLICY IF EXISTS "conseils_select" ON conseils;
CREATE POLICY "conseils_select" ON conseils FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "conseils_admin_all" ON conseils;
CREATE POLICY "conseils_admin_all" ON conseils FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Seen par profil
DROP POLICY IF EXISTS "user_conseil_seen_select" ON user_conseil_seen;
CREATE POLICY "user_conseil_seen_select" ON user_conseil_seen FOR SELECT TO authenticated USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "user_conseil_seen_insert" ON user_conseil_seen;
CREATE POLICY "user_conseil_seen_insert" ON user_conseil_seen FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "user_conseil_seen_update" ON user_conseil_seen;
CREATE POLICY "user_conseil_seen_update" ON user_conseil_seen FOR UPDATE TO authenticated USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "user_conseil_seen_delete" ON user_conseil_seen;
CREATE POLICY "user_conseil_seen_delete" ON user_conseil_seen FOR DELETE TO authenticated USING (auth.uid() = profile_id);

-- Conseils généraux par défaut (peuvent être édités en admin)
INSERT INTO conseils (type, message, display_order) VALUES
  ('general', 'Les intérêts composés font toute la différence sur la durée. Un placement régulier, même modeste, prend de l''ampleur au fil des ans — le temps est votre principal atout.', 1),
  ('general', 'La règle 50 / 30 / 20 est un point de départ : environ 50 % pour les besoins, 30 % pour les envies, 20 % pour l''épargne. À adapter à votre situation réelle.', 2),
  ('general', 'Rembourser un crédit conso à 15 % rapporte plus que tout placement. Avant d''investir, soldez les dettes coûteuses — c''est la décision financière la plus rentable.', 3),
  ('general', 'Répartir entre épargne de sécurité, livrets et investissements réduit le risque global. La diversification, c''est la prudence appliquée au patrimoine.', 4),
  ('general', 'Un fonds d''urgence couvre les imprévus sans toucher à vos investissements. L''objectif : 3 à 6 mois de charges essentielles disponibles à tout moment.', 5),
  ('general', 'Automatiser l''épargne — virement récurrent le jour du salaire — supprime la décision mensuelle. Ce qui n''est pas vu n''est pas dépensé.', 6),
  ('general', 'L''inflation érode silencieusement l''argent qui dort sur un compte courant. Au-delà de votre réserve de sécurité, l''argent qui ne travaille pas perd de la valeur chaque année.', 7),
  ('general', 'Définir un projet concret (voiture, voyage, apport immobilier) rend l''épargne moins abstraite et plus durable. On épargne mieux quand on sait pourquoi.', 8)
ON CONFLICT DO NOTHING;

-- Conseils contextuels (critères, vague 1 — calculables depuis les transactions existantes)
INSERT INTO conseils (type, message, critere_key, display_order) VALUES
  ('contextuel', 'Vous gardez {checking}€ sur le compte courant. Au-delà de votre sécurité, cet argent perd de la valeur avec l''inflation.', 'argent_qui_dort', 1),
  ('contextuel', '{savings_months} mois de dépenses en réserve. La question n''est plus vraiment d''épargner plus — c''est de décider quoi faire avec ce que vous avez déjà.', 'epargne_confortable', 2),
  ('contextuel', 'Votre réserve couvre moins de 2 mois de dépenses. En cas d''imprévu, vous seriez rapidement en difficulté.', 'epargne_insuffisante', 3),
  ('contextuel', '{budgetlibre}€ restent chaque mois sans destination précise. Ce n''est pas bon ou mauvais — mais ce n''est pas un choix non plus.', 'budget_libre_inexploite', 4),
  ('contextuel', 'Vous avez déjà dépassé votre budget ce mois-ci. Les dépenses qui restent seront à surveiller de près.', 'budget_negatif', 5),
  ('contextuel', 'Chaque mois se finit avec très peu de marge. Dans cette configuration, le moindre imprévu déséquilibre tout.', 'budget_serre_chronique', 6),
  ('contextuel', 'Votre projet {projet_nom} est créé depuis {projet_jours} jours, mais aucun versement n''a été fait. Est-ce qu''il est toujours d''actualité ?', 'projet_sans_versement', 7),
  ('contextuel', 'Il reste {delai} mois pour votre projet {projet_nom}, mais vous n''en êtes qu''à {pct}%. Il faut soit accélérer, soit revoir l''objectif ou la date.', 'projet_en_retard', 8),
  ('contextuel', 'Votre patrimoine progresse depuis {n} mois. C''est {gain}€ de plus par rapport à {date_debut}.', 'patrimoine_hausse', 9),
  ('contextuel', 'Vos revenus ont augmenté de {delta}€ par mois en moyenne. C''est une bonne occasion de revoir ce que vous mettez de côté avant que les dépenses n''absorbent la différence.', 'revenus_hausse', 10),
  ('contextuel', 'Vous investissez plus que vous n''épargnez. Si un imprévu arrive, vous risquez de devoir toucher à vos investissements au pire moment.', 'investissement_depasse_epargne', 11),
  ('contextuel', 'La majorité de votre patrimoine est sur des comptes liquides. Une partie dort probablement sans rendement réel.', 'patrimoine_trop_liquide', 12)
ON CONFLICT DO NOTHING;
