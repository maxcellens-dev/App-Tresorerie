/**
 * VOILE DE DÉCONNEXION — un aplat opaque posé au-dessus de tout, de l'instant où l'utilisateur
 * appuie sur « Se déconnecter » jusqu'à l'arrivée effective sur l'accueil.
 *
 * POURQUOI : la déconnexion enchaîne des choses qui se voient toutes à l'écran — la navigation,
 * la session vidée, `queryClient.clear()` (les écrans encore montés se re-rendent SANS données),
 * puis le thème utilisateur oublié (toute la palette change). Aucun ordonnancement ne peut rendre
 * cette séquence invisible : la seule garantie est de ne rien laisser voir pendant qu'elle se joue.
 *
 * Le voile se retire en fondu une fois l'accueil atteint, avec un filet de sécurité (délai maximal)
 * pour ne jamais rester bloqué si la navigation échoue.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useSegments } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';

/** Au-delà de ce délai, on lève le voile quoi qu'il arrive (jamais d'écran bloqué). */
const MAX_VEIL_MS = 4000;

export default function SignOutVeil() {
  const { signingOut, endSignOut } = useAuth();
  const COLORS = useAppColors();
  const segments = useSegments();
  const opacity = useRef(new Animated.Value(1)).current;
  const arrived = (segments[0] ?? 'index') !== '(tabs)';

  useEffect(() => {
    if (!signingOut) { opacity.setValue(1); return; }

    const lift = () => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.quad) })
        .start(({ finished }) => { if (finished) endSignOut(); });
    };
    // Filet de sécurité : le voile se lève même si l'accueil n'est jamais signalé.
    const fallback = setTimeout(lift, MAX_VEIL_MS);
    // Cas nominal : on a quitté les onglets → l'accueil est en place, on découvre.
    const t = arrived ? setTimeout(lift, 120) : null;
    return () => { clearTimeout(fallback); if (t) clearTimeout(t); };
  }, [signingOut, arrived, opacity, endSignOut]);

  if (!signingOut) return null;
  return (
    <Animated.View
      // `pointerEvents` actif : pendant la déconnexion, aucun tap ne doit atteindre l'app en dessous.
      style={[StyleSheet.absoluteFillObject, { backgroundColor: COLORS.bg, opacity, zIndex: 999, elevation: 999 }]}
    />
  );
}
