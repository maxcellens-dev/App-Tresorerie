/**
 * useKeyboardHeight — hauteur du clavier à l'écran (0 s'il est fermé).
 *
 * À n'utiliser QUE dans une fenêtre qu'Android ne redimensionne pas, c'est-à-dire une `Modal`
 * `transparent` / `statusBarTranslucent` : ces fenêtres portent FLAG_LAYOUT_NO_LIMITS, et Android
 * ignore alors `adjustResize`. La saisie reste donc sous le clavier tant qu'on ne la remonte pas.
 *
 * Sur un écran NORMAL, ne pas s'en servir : `app.json` déclare
 * `android.softwareKeyboardLayoutMode: "resize"`, la fenêtre se redimensionne toute seule et la barre
 * de saisie remonte déjà. Y ajouter un padding ne fait que creuser un vide entre elle et le clavier.
 * (Voir l'écran d'ajout de transaction : il ne fait rien d'autre que se laisser redimensionner.)
 *
 * On ne lit que la HAUTEUR du clavier, jamais sa position : mélanger `endCoordinates.screenY`
 * (repère ÉCRAN) et `measureInWindow` (repère FENÊTRE) donne un décalage différent dans la fenêtre
 * principale et dans celle d'une `Modal` — piège dans lequel les versions précédentes sont tombées.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      const reported = e?.endCoordinates?.height ?? 0;
      const top = e?.endCoordinates?.screenY;
      // `height` couvre l'IME entier, barre de suggestions et d'outils comprises. Repli si 0.
      const h = reported > 0
        ? reported
        : (top > 0 ? Math.max(0, Dimensions.get('screen').height - top) : 0);
      if (h > 0) setHeight(h);
    };

    const subs = [
      Keyboard.addListener(showEv, onShow),
      Keyboard.addListener(hideEv, () => setHeight(0)),
    ];
    // Android ré-émet `keyboardDidShow` quand l'IME change de taille ; iOS passe par changeFrame.
    if (Platform.OS === 'ios') subs.push(Keyboard.addListener('keyboardDidChangeFrame', onShow));

    return () => subs.forEach((s) => s.remove());
  }, []);

  return height;
}
