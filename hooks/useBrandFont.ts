/**
 * Police du nom de l'app (titre/logo), configurable en admin (Style Editor).
 * Repli sur « Arial Rounded MT Bold » si rien n'est défini.
 *
 * Sur NATIF, une police IMPORTÉE doit être chargée (expo-font) AVANT que fontFamily ne s'applique.
 * On s'abonne à la version des polices natives → dès que la police du nom est chargée, ce hook
 * re-rend ses consommateurs (welcome, questionnaire…) pour que la police s'affiche enfin.
 */
import { useEffect } from 'react';
import { useStyleConfig } from './useStyleConfig';
import { ensureNativeFonts, useNativeFontsVersion } from '../lib/nativeFonts';

export function useAppNameFont(): string {
  const { data } = useStyleConfig();
  useNativeFontsVersion(); // re-render quand une police importée finit de charger → fontFamily s'applique
  // Charge les polices importées si besoin (idempotent) — indépendant de FontApplier.
  useEffect(() => {
    const cf = data?.custom_fonts ?? [];
    if (cf.length) ensureNativeFonts(cf as any);
  }, [data?.custom_fonts]);
  const f = data?.app_name_font?.trim();
  // On renvoie TOUJOURS la vraie famille : tant qu'elle n'est pas chargée sur natif, le système sert de
  // repli (aucun « tofu » pour du texte) ; dès qu'elle charge, le re-render ci-dessus l'applique.
  return f && f.length > 0 ? f : 'Arial Rounded MT Bold';
}
