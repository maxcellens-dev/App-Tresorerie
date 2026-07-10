/**
 * useKeyboardClearance — décalage à appliquer à une barre de saisie pour la garder au-dessus du clavier.
 *
 * Contexte : les deux mondes coexistent et on ne peut PAS deviner lequel s'applique.
 *  • écran normal : Android redimensionne la fenêtre (adjustResize) → la barre remonte toute seule ;
 *  • dans une `Modal` : la fenêtre du modal ne se redimensionne pas → la barre reste sous le clavier.
 *
 * Approches écartées (ne pas y revenir) :
 *  1. `KeyboardAvoidingView` : mesure faux en edge-to-edge et dans les modaux `statusBarTranslucent`.
 *  2. Ajouter aveuglément la hauteur du clavier : propulse la barre deux fois trop haut sur les
 *     écrans que le système a déjà redimensionnés.
 *  3. Détecter le redimensionnement via `Dimensions.get('window')` : la valeur ne se met pas à jour
 *     de façon fiable au moment où `keyboardDidShow` est émis (course), d'où des résultats opposés
 *     d'un écran à l'autre.
 *
 * Approche retenue : on MESURE le chevauchement réellement restant, puis on ITÈRE. Chaque passe
 * ajoute ce qui manque encore ; le calcul converge (le padding déjà appliqué déplace la cible, donc
 * la passe suivante mesure 0). Cela s'auto-adapte aux deux mondes, et rattrape les claviers qui
 * GRANDISSENT après coup (barre de suggestions, outils, emojis).
 *
 * Piège corrigé : `measureInWindow` renvoie des coordonnées FENÊTRE, alors que `endCoordinates.screenY`
 * est en coordonnées ÉCRAN. Quand la fenêtre démarre sous la barre de statut, le chevauchement était
 * sous-estimé d'une constante — la barre remontait « mais pas assez », et aucune itération ne
 * pouvait rattraper l'écart.
 */
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, StatusBar, type View } from 'react-native';

/** Instants de re-mesure après l'apparition du clavier (stabilisation du layout + barres tardives). */
const PASSES_MS = [0, 120, 320, 650];

export function useKeyboardClearance(targetRef: React.RefObject<View | null>, margin = 12): number {
  const [pad, setPad] = useState(0);
  const padRef = useRef(0);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const timers: ReturnType<typeof setTimeout>[] = [];

    const apply = (n: number) => {
      if (Math.abs(n - padRef.current) < 0.5) return;
      padRef.current = n;
      setPad(n);
    };

    const compute = (e: any) => {
      const kbTop = e?.endCoordinates?.screenY;
      const reported = e?.endCoordinates?.height ?? 0;
      if (kbTop == null || kbTop <= 0) return;
      // `height` remonte parfois 0 en edge-to-edge → on la reconstruit depuis le haut du clavier.
      const kbH = reported > 0 ? reported : Math.max(0, Dimensions.get('screen').height - kbTop);
      if (kbH <= 0) return;

      // Passage fenêtre → écran. Sur Android sans edge-to-edge, la fenêtre commence sous la barre
      // de statut. En edge-to-edge l'offset vaut 0 et on surcompense de ~30 px : sans conséquence
      // (un peu plus d'air), là où sous-compenser laissait la saisie masquée.
      const winOffset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

      const measure = () => {
        targetRef.current?.measureInWindow((_x, y, _w, h) => {
          if (y == null || h == null) return;
          const overlap = y + h + winOffset - kbTop + margin;
          if (overlap <= 0) return; // déjà dégagée (fenêtre redimensionnée par le système)
          apply(Math.min(kbH + margin, padRef.current + overlap));
        });
      };

      timers.forEach(clearTimeout);
      timers.length = 0;
      PASSES_MS.forEach((d) => timers.push(setTimeout(() => requestAnimationFrame(measure), d)));
    };

    const s = Keyboard.addListener(showEv, compute);
    // Android ré-émet `keyboardDidShow` quand l'IME change de taille. `keyboardDidChangeFrame` est iOS.
    const chg = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', compute) : null;
    const hddn = Keyboard.addListener(hideEv, () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      apply(0);
    });

    return () => {
      timers.forEach(clearTimeout);
      s.remove(); chg?.remove(); hddn.remove();
    };
  }, [targetRef, margin]);

  return pad;
}
