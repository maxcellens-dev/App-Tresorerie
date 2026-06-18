/**
 * Met en évidence l'élément d'action ciblé par une étape du guide « Pour bien démarrer »
 * lorsqu'on arrive sur la page via la checklist (param ?onb=<clé>).
 */
import { Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';

export function useOnbHighlight(key: string): boolean {
  const params = useLocalSearchParams<{ onb?: string }>();
  const { user } = useAuth();
  const ob = useOnboarding(user?.id);
  if (params.onb !== key) return false;
  // Dès que l'étape est accomplie (ex. on a cliqué la zone), on retire le cadre.
  const step = ob.steps.find((s) => s.key === key);
  return step ? !step.done : true;
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
