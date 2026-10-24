/**
 * ACCUEIL DE L'APP (téléphone, avant connexion) — l'équivalent natif de la vitrine web
 * (GardenLandingPage), avec les mêmes mots.
 *
 * Haut : le logo et le nom. Puis la promesse, l'aperçu de l'accueil (le vrai rendu, sur un
 * exemple : jamais de vraies données), les deux boutons, les trois étapes et les réseaux.
 * L'administration garde la marque, les libellés des deux boutons et les réseaux (`L`, config déjà
 * fusionnée par WelcomeScreen, qui garde la main sur la révélation).
 */
import { Animated, Image, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import GardenText from '../garden/GardenText';
import GardenButton from '../garden/GardenButton';
import SocialLinks from './SocialLinks';
import AppPreview from './AppPreview';
import { HOW } from './GardenLandingPage';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import type { mergeLanding } from '../../hooks/config/useLandingConfig';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';

/** Fond sombre → icônes de la barre d'état claires. */
const isDarkBg = () => { const h = G.bg.replace('#', ''); const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255; return 0.299 * v(0) + 0.587 * v(2) + 0.114 * v(4) < 0.5; };

interface Props {
  L: ReturnType<typeof mergeLanding>;
  /** Aperçu dans l'admin : pas de navigation, pas de barre d'état. */
  preview?: boolean;
  /** Fondu d'entrée piloté par WelcomeScreen. */
  fade: Animated.Value;
}

export default function GardenWelcome({ L, preview, fade }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appNameFontStyle = useAppNameFontStyle();
  useGardenFonts();
  const go = (path: string) => { if (!preview) router.push(path as any); };
  const hasSocials = !!L.socials?.enabled && (L.socials.items ?? []).some((s) => (s.url ?? '').trim().length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: G.bg }}>
      {!preview ? <StatusBar style={isDarkBg() ? 'light' : 'dark'} /> : null}
      <ScrollView contentContainerStyle={{ paddingTop: (preview ? 0 : insets.top) + GARDEN_SPACE.lg, paddingBottom: (preview ? 0 : insets.bottom) + 40, paddingHorizontal: 16, gap: GARDEN_SPACE.lg }} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fade, gap: GARDEN_SPACE.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Image source={require('../../assets/logo.png')} style={{ width: 40, height: 40 }} resizeMode="contain" />
            <GardenText {...APP_NAME_TEXT_PROPS} variant="title" style={appNameFontStyle}>{L.brandName}</GardenText>
          </View>

          <View style={{ gap: 6, alignItems: 'center' }}>
            <GardenText variant="smallStrong" color={G.branchesText} center>Ton budget, clair en 3 secondes</GardenText>
            <GardenText variant="display" center style={{ fontSize: 30, lineHeight: 36 }} accessibilityRole="header">Sache ce que tu peux vraiment dépenser.</GardenText>
            <GardenText variant="body" color={G.inkSoft} center>Relyka calcule ce qu’il te reste vraiment ce mois-ci, et Pépin te dit quoi en faire.</GardenText>
          </View>

          <AppPreview compact />

          <View style={{ gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: 20, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg }}>
            <GardenText variant="heading" center>Pépin t’attend.</GardenText>
            <GardenText variant="small" color={G.inkSoft} center style={{ marginBottom: 4 }}>Gratuit pour commencer. Cinq minutes, et ton Relyka se calcule tout seul.</GardenText>
            <GardenButton label={L.mobileCtaPrimaryLabel} onPress={() => go('/login')} />
            <GardenButton label={L.mobileCtaSecondaryLabel} variant="secondary" onPress={() => go('/register')} />
          </View>

          {/* Les trois étapes (mêmes mots que la vitrine web), puis la promesse. */}
          <View style={{ gap: GARDEN_SPACE.sm }}>
            <GardenText variant="heading" center>Trois étapes, cinq minutes.</GardenText>
            <View style={{ backgroundColor: G.card, borderRadius: 20, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>
              {HOW.map((h, i) => (
                <View key={h.n} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, padding: GARDEN_SPACE.lg, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: G.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <GardenText variant="bodyStrong" color={G.onPrimary}>{h.n}</GardenText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <GardenText variant="bodyStrong">{h.title}</GardenText>
                    <GardenText variant="small" color={G.inkSoft}>{h.text}</GardenText>
                  </View>
                </View>
              ))}
            </View>
            <GardenText variant="smallStrong" color={G.branchesText} center>Relyka ne déplace jamais ton argent : il te conseille, c’est toi qui décides.</GardenText>
          </View>

          {hasSocials ? (
            <View pointerEvents={preview ? 'none' : 'auto'}><SocialLinks config={L.socials} color={G.muted} align="center" /></View>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
