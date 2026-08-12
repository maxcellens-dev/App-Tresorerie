-- Donne le rôle admin au compte Relyka.dev@gmail.com.
-- 1) Met à jour le profil existant (si le compte est déjà créé).
UPDATE public.profiles
SET is_admin = true
WHERE lower(email) = lower('Relyka.dev@gmail.com');

-- 2) Met à jour le trigger de création de profil pour inclure ce compte comme admin
--    (utile si le compte est (re)créé plus tard).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    (lower(COALESCE(NEW.email, '')) IN ('maxcellens@gmail.com', 'relyka.dev@gmail.com'))
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    is_admin = EXCLUDED.is_admin;
  RETURN NEW;
END;
$$;
