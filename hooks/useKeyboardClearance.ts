/**
 * useKeyboardClearance — décalage à appliquer à une barre ancrée en BAS d'écran (zone de saisie)
 * pour qu'elle reste nettement au-dessus du clavier.
 *
 * Historique des ratés, pour ne pas y revenir :
 *  1. `KeyboardAvoidingView` / `adjustResize` : ignorés en edge-to-edge (Android récent) et dans les
 *     modaux `statusBarTranslucent` → saisie masquée.
 *  2. Mesure du chevauchement (`measureInWindow` vs `endCoordinates.screenY`) : mélange deux repères.
 *     `measureInWindow` est relatif à la FENÊTRE, `screenY` à l'ÉCRAN. Dès qu'il y a un décalage
 *     (barre de statut, encoche…), le chevauchement est sous-estimé d'une constante → la barre
 *     remonte « mais pas assez », et aucune itération ne rattrape l'écart.
 *
 * Approche retenue : on n'essaie plus de localiser la cible. Elle est ancrée en bas, donc il suffit
 * de la remonter de TOUTE la hauteur occupée par le clavier (barre de suggestions/outils incluse :
 * elle fait partie de la fenêtre de l'IME et est donc comprise dans `height` / dans l'écart entre le
 * haut du clavier et le bas de l'écran), plus une marge de confort.
 *
 * Seule exception : si le système a réellement redimensionné la fenêtre de l'app (adjustResize
 * effectif), la barre est déjà remontée toute seule → on n'ajoute rien, sinon on la propulserait
 * deux fois trop haut. On le détecte en comparant la hauteur de fenêtre avant/pendant le clavier.
 */
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, type View } from 'react-native';

export function useKeyboardClearance(_targetRef: React.RefObject<View | null>, margin = 12): number {
  const [pad, setPad] = useState(0);
  const padRef = useRef(0);
  /** Hauteur de fenêtre clavier FERMÉ — référence pour détecter un vrai redimensionnement système. */
  const baseWinH = useRef(Dimensions.get('window').height);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const apply = (n: number) => {
      if (Math.abs(n - padRef.current) < 0.5) return;
      padRef.current = n;
      setPad(n);
    };

    const compute = (e: any) => {
      const kbTop = e?.endCoordinates?.screenY;
      const reported = e?.endCoordinates?.height ?? 0;
      const screenH = Dimensions.get('screen').height;
      // `height` remonte parfois 0 en edge-to-edge → on le reconstruit depuis le haut du clavier.
      const kbH = reported > 0 ? reported : (kbTop != null && kbTop > 0 ? Math.max(0, screenH - kbTop) : 0);
      if (kbH <= 0) return;

      // La fenêtre s'est-elle réellement rétrécie ? (tolérance : barres système)
      const winH = Dimensions.get('window').height;
      const systemResized = winH < baseWinH.current - 40;

      apply(systemResized ? 0 : kbH + margin);
    };

    const s = Keyboard.addListener(showEv, compute);
    // Android ré-émet `keyboardDidShow` quand l'IME change de taille (barre de suggestions, emojis,
    // clavier vocal…) → la compensation suit. `keyboardDidChangeFrame` n'existe que sur iOS.
    const chg = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', compute) : null;
    const hddn = Keyboard.addListener(hideEv, () => {
      baseWinH.current = Dimensions.get('window').height;
      apply(0);
    });
    return () => { s.remove(); chg?.remove(); hddn.remove(); };
  }, [margin]);

  return pad;
}
