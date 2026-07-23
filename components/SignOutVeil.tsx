/**
 * VOILE DE DÉCONNEXION — un aplat opaque posé au-dessus de tout, de l'instant où l'utilisateur
 * appuie sur « Se déconnecter » jusqu'à l'arrivée effective sur l'accueil.
 *
 * POURQUOI : la déconnexion enchaîne des choses qui se voient toutes à l'écran — la navigation,
 * la session vidée, `queryClient.clear()` (les écrans encore montés se re-rendent SANS données),
 * puis le thème utilisateur oublié (toute la palette change). Aucun ordonnancement ne peut rendre
 * cette séquence invisible : la seule garantie est de ne rien laisser voir pendant qu'elle se joue.
 *
 * Le voile se retire en fondu une fois l'accueil atteint ET la purge terminée (les deux : voir le
 * commentaire dans l'effet), avec un filet de sécurité (délai maximal) pour ne jamais rester bloqué.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useSegments } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';

/** Au-delà de ce délai, on lève le voile quoi qu'il arrive (jamais d'écran bloqué). */
const MAX_VEIL_MS = 4000;

export default function SignOutVeil() {
  const { signingOut, signOutSettled, endSignOut } = useAuth();
  const COLORS = useAppColors();
  const segments = useSegments();
  const opacity = useRef(new Animated.Value(1)).current;
  const arrived = (segments[0] ?? 'index') !== '(tabs)';

  // Le voile GARDE la couleur qu'avait l'app à l'instant du clic : la palette bascule pendant la
  // déconnexion (thème utilisateur oublié → thème admin), et un voile qui change de couleur en
  // cours de route est exactement le clignotement qu'on veut supprimer. Le fondu final révèle
  // l'accueil dans sa palette — une transition, pas un à-coup.
  const veilBg = useRef(COLORS.bg);
  if (!signingOut) veilBg.current = COLORS.bg;

  useEffect(() => {
    if (!signingOut) { opacity.setValue(1); return; }

    const lift = () => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.quad) })
        .start(({ finished }) => { if (finished) endSignOut(); });
    };
    // Filet de sécurité : le voile se lève même si rien n'est jamais signalé (jamais d'écran bloqué).
    const fallback = setTimeout(lift, MAX_VEIL_MS);
    // Cas nominal : DEUX conditions, et surtout pas la première seule.
    //  • `arrived`  : on a quitté les onglets, l'accueil est en place ;
    //  • `settled`  : la purge est finie (session, caches, thème) → plus rien ne peut bouger.
    // Se lever sur `arrived` seul (ce que faisait ce composant) découvrait un état intermédiaire où
    // `user` était encore renseigné sur /welcome : le garde d'auth renvoyait alors sur '/' → pilotage
    // → puis retour à l'accueil quand la session tombait enfin. C'était le clignotement signalé.
    const t = arrived && signOutSettled ? setTimeout(lift, 60) : null;
    return () => { clearTimeout(fallback); if (t) clearTimeout(t); };
  }, [signingOut, signOutSettled, arrived, opacity, endSignOut]);

  if (!signingOut) return null;
  return (
    <Animated.View
      // `pointerEvents` actif : pendant la déconnexion, aucun tap ne doit atteindre l'app en dessous.
      style={[StyleSheet.absoluteFillObject, { backgroundColor: veilBg.current, opacity, zIndex: 999, elevation: 999 }]}
    />
  );
}
