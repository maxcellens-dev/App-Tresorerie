/**
 * useDeferredMount — montage en deux temps pour les ÉCRANS LOURDS.
 *
 * Au tap sur un onglet, monter d'un bloc un gros écran (centaines de hooks/useMemo + arbre profond)
 * fige l'UI le temps du rendu : la navigation paraît lente. Pattern : l'écran rend d'abord un
 * SQUELETTE ultraléger (1 frame → la transition est instantanée), puis son vrai contenu dès que les
 * interactions en cours sont terminées. L'utilisateur voit la page s'ouvrir tout de suite et le
 * contenu arriver.
 *
 * Le squelette dessine la SILHOUETTE de la page qu'il annonce (`variant`), pas un rond de
 * chargement : à délai identique, l'un se lit « la page est ouverte », l'autre « l'app rame ».
 *
 * Usage : `export default withDeferredMount(Body, 'list')`
 * (les hooks/calculs lourds vivent dans Body → RIEN ne tourne pendant la frame de transition).
 */
import React, { useEffect, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import ScreenSkeleton, { type SkeletonVariant } from '../components/ScreenSkeleton';

export function useDeferredMount(): boolean {
  // WEB : pas de différé — runAfterInteractions n'y est pas fiable (callback jamais déclenché →
  // squelette infini), et le moteur JS du navigateur rend le montage direct instantané de toute façon.
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let done = false;
    const finish = () => { if (!done) { done = true; setReady(true); } };
    const task = InteractionManager.runAfterInteractions(finish);
    // Filet : si les « interactions » ne se terminent jamais (animation en boucle quelque part),
    // on monte quand même — le différé est une optimisation, jamais un blocage.
    const fallback = setTimeout(finish, 300);
    return () => { task.cancel(); clearTimeout(fallback); };
  }, []);
  return ready;
}

/**
 * HOC : enveloppe un écran LOURD → il rend un squelette 1 frame puis son vrai contenu (natif ;
 * direct sur web). `export default withDeferredMount(Body)`. Le composant `Body` porte TOUS les
 * hooks/calculs → rien ne tourne pendant la frame de transition (tap d'onglet/lien instantané).
 */
export function withDeferredMount<P extends object>(
  Body: React.ComponentType<P>,
  /** Silhouette affichée pendant la transition — celle de la page annoncée. */
  variant: SkeletonVariant = 'list',
): React.FC<P> {
  const Wrapped: React.FC<P> = (props) =>
    useDeferredMount() ? React.createElement(Body, props) : React.createElement(ScreenSkeleton, { variant });
  Wrapped.displayName = `withDeferredMount(${Body.displayName || Body.name || 'Screen'})`;
  return Wrapped;
}
