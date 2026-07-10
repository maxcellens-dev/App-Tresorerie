/**
 * useKeyboardInset — hauteur dont il faut décaler une zone ÉPINGLÉE EN BAS pour qu'elle reste
 * au-dessus du clavier. 0 quand le clavier est fermé.
 *
 * Source : `KeyboardEvents` de react-native-keyboard-controller, qui lit les insets système
 * (`WindowInsetsCompat.Type.ime()` sur Android, le frame du clavier sur iOS). Deux propriétés que
 * les API `Keyboard` de React Native n'ont pas, et qui règlent définitivement le sujet :
 *
 *  1. la hauteur inclut TOUT ce que dessine le clavier — bandeau de suggestions, barre d'outils
 *     Gboard, rangée d'emojis. `Keyboard.metrics()` s'appuie sur `onComputeInsets`, que Gboard
 *     renseigne SANS son bandeau : d'où une zone de saisie toujours coupée d'une rangée ;
 *  2. c'est une distance mesurée depuis le bas de la FENÊTRE courante (celle d'une `Modal`
 *     comprise), et non depuis le bas de l'écran. Plus de conversion de repère, plus de
 *     `StatusBar.currentHeight`, plus de mesure de la barre à recaler.
 *
 * Elle vaut donc directement comme `paddingBottom` / `marginBottom` d'un élément collé en bas, sur
 * n'importe quel appareil, clavier tiers compris.
 *
 * Prérequis : `<KeyboardProvider>` monté à la racine (app/_layout.tsx). Module NATIF → nécessite une
 * build store, pas une OTA (cf. runtimeVersion dans app.json).
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';

export function useKeyboardInset(margin = 0): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return; // le clavier virtuel du navigateur ne masque pas la page
    const show = (e: { height: number }) => setInset(e.height > 0 ? e.height + margin : 0);
    const hide = () => setInset(0);
    // `will*` : l'ajustement suit l'animation d'ouverture. `did*` : filet, et sur Android le clavier
    // ré-émet l'événement quand l'IME change de taille (bandeau qui apparaît, passage aux emojis).
    const subs = [
      KeyboardEvents.addListener('keyboardWillShow', show),
      KeyboardEvents.addListener('keyboardDidShow', show),
      KeyboardEvents.addListener('keyboardWillHide', hide),
      KeyboardEvents.addListener('keyboardDidHide', hide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [margin]);

  return inset;
}
