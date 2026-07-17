/**
 * useDeferredMount — montage en deux temps pour les ÉCRANS LOURDS.
 *
 * Au tap sur un onglet, monter d'un bloc un gros écran (centaines de hooks/useMemo + arbre profond)
 * fige l'UI le temps du rendu : la navigation paraît lente. Pattern : l'écran rend d'abord un
 * SQUELETTE ultraléger (1 frame → la transition est instantanée), puis son vrai contenu dès que les
 * interactions en cours sont terminées. L'utilisateur voit la page s'ouvrir tout de suite et le
 * contenu arriver — exactement le comportement voulu (« pas grave s'il voit charger »).
 *
 * Usage : `export default function Screen() { return useDeferredMount() ? <Body /> : <ScreenSkeleton /> }`
 * (les hooks/calculs lourds vivent dans Body → RIEN ne tourne pendant la frame de transition).
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

export function useDeferredMount(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);
  return ready;
}
