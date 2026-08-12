/**
 * useDeferredMount — montage en deux temps pour les ÉCRANS LOURDS.
 *
 * Au tap sur un onglet, monter d'un bloc un gros écran (centaines de hooks/useMemo + arbre profond)
 * fige l'UI le temps du rendu : la navigation paraît lente. Pattern : l'écran rend d'abord le
 * CERCLE DE CHARGEMENT (1 frame → la transition est instantanée), puis son vrai contenu dès que les
 * interactions en cours sont terminées. L'utilisateur voit la page s'ouvrir tout de suite.
 *
 * C'est le MÊME cercle que celui des données qui arrivent (components/PageLoader) : une seule façon
 * d'attendre dans toute l'app. Une page ne montre donc jamais de zones vides qui se remplissent —
 * elle attend franchement, puis s'affiche complète.
 *
 * Usage : `export default withDeferredMount(Body)`
 * (les hooks/calculs lourds vivent dans Body → RIEN ne tourne pendant la frame de transition).
 */
import React, { useEffect, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import PageLoader from '../../components/layout/PageLoader';

export function useDeferredMount(): boolean {
  // WEB : pas de différé — runAfterInteractions n'y est pas fiable (callback jamais déclenché →
  // cercle infini), et le moteur JS du navigateur rend le montage direct instantané de toute façon.
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
 * HOC : enveloppe un écran LOURD → il rend le cercle 1 frame puis son vrai contenu (natif ; direct
 * sur web). `export default withDeferredMount(Body)`. Le composant `Body` porte TOUS les
 * hooks/calculs → rien ne tourne pendant la frame de transition (tap d'onglet/lien instantané).
 */
export function withDeferredMount<P extends object>(Body: React.ComponentType<P>): React.FC<P> {
  const Wrapped: React.FC<P> = (props) =>
    useDeferredMount() ? React.createElement(Body, props) : React.createElement(PageLoader);
  Wrapped.displayName = `withDeferredMount(${Body.displayName || Body.name || 'Screen'})`;
  return Wrapped;
}
