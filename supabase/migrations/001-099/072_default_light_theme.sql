-- ─────────────────────────────────────────────────────────────
-- 072 — Thème par défaut des NOUVEAUX utilisateurs : clair + émeraude
-- ─────────────────────────────────────────────────────────────
-- Le trigger handle_new_user() crée le profil sans préciser le thème :
-- la valeur par défaut de la colonne s'applique. On la passe de 'dark' à 'light'.
-- 'emerald' est déjà la 1ère couleur d'accent (theme_preset DEFAULT depuis la 025).
--
-- N'affecte QUE les nouveaux profils : les lignes existantes conservent leur valeur.
ALTER TABLE profiles ALTER COLUMN theme_mode SET DEFAULT 'light';

NOTIFY pgrst, 'reload schema';
