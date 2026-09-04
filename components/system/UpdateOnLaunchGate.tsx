/**
 * UpdateOnLaunchGate — le voile affiché pendant que la mise à jour OTA téléchargée par le natif
 * finit d'arriver, pour qu'elle s'applique SUR CE LANCEMENT et pas au suivant.
 *
 * Il ne s'affiche que s'il y a réellement quelque chose à attendre — le natif en train de chercher
 * ou de télécharger au moment où le JS démarre (cf. lib/platform/otaUpdate). Le reste du temps,
 * c'est-à-dire à la quasi-totalité des lancements, il ne rend rien et ne coûte rien.
 *
 * Il reprend TRAIT POUR TRAIT le splash (même fond, même logo, même position) : l'utilisateur ne
 * doit pas voir un écran de plus, mais le même écran qui met un peu plus de temps — avec, pour ne
 * pas le laisser dans le noir, une ligne qui dit ce qui se passe.
 */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Animated, Easing, Dimensions } from 'react-native';
import { useBrandColors } from '../../hooks/theme/useBrandColors';
import { useUpdateOnLaunch } from '../../lib/platform/otaUpdate';

/** Doit correspondre au splash natif (app.json) et à AnimatedSplash — transition invisible. */
const SPLASH_BG = '#F4EFE6';
const BG_DARK = '#0D2E2A';
const LOGO = 96;

export default function UpdateOnLaunchGate() {
  const { waiting, downloading, progress } = useUpdateOnLaunch();
  const COLORS = useBrandColors();
  const isLight = COLORS.mode === 'light';

  /* Le texte n'apparaît qu'au bout d'un instant : si la mise à jour arrive en une seconde, annoncer
     « mise à jour en cours » n'aurait fait que clignoter. Le splash, lui, est là dès la 1ʳᵉ frame. */
  const captionFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      Animated.timing(captionFade, { toValue: 1, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }, 1200);
    return () => clearTimeout(t);
  }, [waiting, captionFade]);

  if (!waiting) return null;

  const screenH = Dimensions.get('screen').height;
  const logoTop = screenH / 2 - LOGO / 2;
  const bg = isLight ? SPLASH_BG : BG_DARK;
  const textColor = isLight ? '#0D2E2A' : '#F4EFE6';
  const pct = progress != null ? Math.max(0, Math.min(1, progress)) : null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: bg }]}>
      <View style={[styles.logoWrap, { top: logoTop }]}>
        <Image source={require('../../assets/logo.png')} style={{ width: LOGO, height: LOGO }} resizeMode="contain" fadeDuration={0} />
      </View>
      <Animated.View style={[styles.caption, { opacity: captionFade }]}>
        <Text style={[styles.title, { color: textColor }]}>Installation de la dernière version</Text>
        <Text style={[styles.sub, { color: textColor, opacity: 0.7 }]}>
          {downloading ? 'Téléchargement en cours…' : 'Encore quelques secondes…'}
        </Text>
        {/* Barre de progression seulement quand elle veut dire quelque chose (le serveur annonce la
            taille) : une barre qui reste à zéro inquiète plus qu'elle ne rassure. */}
        {pct != null && (
          <View style={[styles.track, { backgroundColor: textColor + '22' }]}>
            <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: COLORS.emerald }]} />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Au-dessus du splash animé (zIndex 9999) : c'est lui qui prend le relais, pas l'inverse.
  root: { zIndex: 10000, elevation: 10000 },
  logoWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  caption: { position: 'absolute', left: 24, right: 24, bottom: 72, alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center' },
  track: { width: 180, height: 4, borderRadius: 999, overflow: 'hidden', marginTop: 6 },
  fill: { height: '100%', borderRadius: 999 },
});
