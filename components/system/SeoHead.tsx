/**
 * SeoHead — applique la config SEO (admin) au <head> du document, côté WEB uniquement.
 * Monté une fois à la racine web ; `page` permet une surcharge de titre/description par page.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useSeoConfig } from '../../hooks/config/useSeo';
import { applySeoHead } from '../../lib/platform/seo';

export default function SeoHead({ page }: { page?: string }) {
  const { data: cfg } = useSeoConfig();
  useEffect(() => {
    if (Platform.OS === 'web' && cfg) applySeoHead(cfg, page);
  }, [cfg, page]);
  return null;
}
