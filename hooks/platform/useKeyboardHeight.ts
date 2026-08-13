/**
 * useKeyboardHeight — hauteur du clavier qui RECOUVRE réellement la fenêtre (0 s'il est fermé).
 *
 * Pourquoi mesurer plutôt que laisser le système faire : en edge-to-edge (targetSdk ≥ 35), la
 * fenêtre Android n'est JAMAIS redimensionnée à l'ouverture du clavier — `softwareKeyboardLayoutMode:
 * "resize"` est ignoré et `KeyboardAvoidingView` (RN comme lib) ne décale rien de fiable dès que le
 * contenu ne part pas du haut de la fenêtre. On mesure donc le chevauchement et on l'applique
 * nous-mêmes (padding bas d'un ScrollView, zone utile d'une modale…).
 *
 * Source retenue : `useKeyboardHandler` de react-native-keyboard-controller (insets système), la
 * SEULE fiable ici — Gboard déclare ses insets sans son bandeau d'outils (~48 dp), donc les
 * événements clavier de RN et `Keyboard.metrics()` sous-estiment la hauteur. `KeyboardEvents` de la
 * lib n'est pas utilisable non plus : son canal est suspendu pendant les `Modal`, justement là où on
 * en a le plus besoin. On garde les événements RN en FILET (on prend le maximum des deux) au cas où
 * le handler ne serait pas alimenté.
 *
 * Web : la lib est un no-op → on suit `visualViewport`, qui rétrécit quand le clavier logiciel
 * s'ouvre sur mobile.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';

export function useKeyboardHeight(): number {
  // Source principale (natif) : insets système, connus dès le DÉBUT de l'animation.
  const [controllerHeight, setControllerHeight] = useState(0);
  // Filet : événements clavier RN (+ visualViewport sur le web).
  const [fallbackHeight, setFallbackHeight] = useState(0);

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        runOnJS(setControllerHeight)(Math.max(0, Math.round(e.height)));
      },
      onEnd: (e) => {
        'worklet';
        runOnJS(setControllerHeight)(Math.max(0, Math.round(e.height)));
      },
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv: any = typeof window !== 'undefined' ? (window as any).visualViewport : null;
      if (!vv) return;
      const update = () => {
        // Ce que le clavier mange en bas de la fenêtre.
        const overlap = window.innerHeight - vv.height - vv.offsetTop;
        setFallbackHeight(overlap > 80 ? Math.round(overlap) : 0);
      };
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }

    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setFallbackHeight(Math.max(0, Math.round(e?.endCoordinates?.height ?? 0)));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setFallbackHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return Math.max(controllerHeight, fallbackHeight);
}

export default useKeyboardHeight;
