/**
 * Met en évidence l'élément d'action ciblé par une étape du guide « Pour bien démarrer »
 * lorsqu'on arrive sur la page via la checklist (param ?onb=<clé>).
 */
import { Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export function useOnbHighlight(key: string): boolean {
  const params = useLocalSearchParams<{ onb?: string }>();
  return params.onb === key;
}

/** Style de surbrillance (anneau + halo) à fusionner sur l'élément cible quand `on` est vrai. */
export function onbGlow(COLORS: any, on: boolean) {
  if (!on) return null;
  return {
    borderWidth: 2,
    borderColor: COLORS.emerald,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: `0 0 0 3px ${COLORS.emerald}33` } as any)
      : { shadowColor: COLORS.emerald, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 8 }),
  };
}
