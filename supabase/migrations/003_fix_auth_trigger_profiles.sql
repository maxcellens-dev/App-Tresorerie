-- ============================================================
-- Fix: "Database error creating new user" (trigger + RLS sur profiles)
-- ============================================================

-- 1. Politique INSERT (pour signUp depuis l'app : auth.uid() = id)
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 1b. Permettre au trigger (exécuté par le rôle postgres) d'insérer un profil
--     Indispensable quand on crée un user depuis le Dashboard Supabase.
--     Si erreur "role postgres does not exist", remplacez postgres par votre rôle DB (ex. supabase_admin).
CREATE POLICY "Allow trigger insert profile"
  ON profiles FOR INSERT
  TO postgres
  WITH CHECK (true);

-- 2. Trigger plus robuste (schéma public, NULL gérés)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Recréer le trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
