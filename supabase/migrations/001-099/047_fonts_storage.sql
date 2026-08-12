-- Migration 047 : Stockage des polices personnalisées (Style Editor)
--
-- Bucket public « fonts » : lecture publique (nécessaire pour charger la police via @font-face
-- sur le web), écriture réservée aux administrateurs.

INSERT INTO storage.buckets (id, name, public)
VALUES ('fonts', 'fonts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Lecture publique des fichiers du bucket fonts
DROP POLICY IF EXISTS "fonts_public_read" ON storage.objects;
CREATE POLICY "fonts_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'fonts');

-- Écriture (insert / update / delete) réservée aux admins
DROP POLICY IF EXISTS "fonts_admin_insert" ON storage.objects;
CREATE POLICY "fonts_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fonts' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "fonts_admin_update" ON storage.objects;
CREATE POLICY "fonts_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'fonts' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (bucket_id = 'fonts' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "fonts_admin_delete" ON storage.objects;
CREATE POLICY "fonts_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'fonts' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
