/**
 * useBrandColors — palette de marque fixe (sombre + accent émeraude), indépendante
 * des préférences utilisateur. Utilisée par les écrans pré-auth (accueil, connexion,
 * inscription) : ce n'est pas un choix utilisateur, l'identité reste verte en permanence.
 * Respecte les réglages globaux du Style Editor (transparence cartes, presets, couleurs sémantiques).
 */
import { useMemo } from 'react';
import { useStyleConfig } from './useStyleConfig';
import { buildColors, type AppColors } from '../theme/palette';

export function useBrandColors(): AppColors {
  const { data: styleConfig } = useStyleConfig();
  return useMemo(
    () => buildColors('dark', 'emerald', {
      cardAlpha: styleConfig?.dark.card_alpha,
      customAccents: styleConfig?.custom_accents,
      extraPresets: styleConfig?.extra_presets,
      semanticColors: styleConfig?.semantic_colors,
    }),
    [styleConfig?.dark.card_alpha, styleConfig?.custom_accents, styleConfig?.extra_presets, styleConfig?.semantic_colors]
  );
}
