/**
 * useNavBack — retour fiable vers la page réellement précédente.
 *
 * Contourne l'accumulation de la pile imbriquée des pages secondaires : au lieu de `router.back()`
 * (qui peut dépiler vers une page secondaire obsolète), on navigue vers le chemin précédent suivi
 * dans navHistory. Repli sur le Pilotage si aucun précédent (ex. ouverture directe par URL).
 */
import { useRouter } from 'expo-router';
import { consumePreviousRoute } from '../lib/navHistory';

export function useNavBack(fallback: string = '/(tabs)/pilotage') {
  const router = useRouter();
  return () => {
    const prev = consumePreviousRoute();
    router.navigate((prev ?? fallback) as any);
  };
}
