/**
 * ACCUEIL DE L'APP (téléphone, avant connexion), dans le style du Jardin — l'équivalent natif de la
 * vitrine web (GardenLandingPage).
 *
 * Haut : le logo et le nom. Puis l'arbre en 3D (la VRAIE scène de l'app, sur une situation
 * d'exemple : jamais de vraies données), Pépin qui salue, à l'heure et à la saison du moment. Puis
 * l'accroche, les deux boutons, les points forts et les réseaux.
 *
 * Tous les textes viennent de l'administration (app_config.landing › section Mobile), comme sur
 * l'ancien accueil : rien en dur à part la structure. `L` est la config déjà fusionnée par
 * WelcomeScreen, qui garde la main sur le moment de la révélation (police, textes, splash).
 */
import { Animated, Image, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import GardenScene from '../garden/GardenScene';
import GardenButton from '../garden/GardenButton';
import GardenIcon from '../garden/GardenIcon';
import SocialLinks from './SocialLinks';
import { HERO } from './GardenLandingPage';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import type { mergeLanding } from '../../hooks/config/useLandingConfig';
import type { GardenIconKey } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';

/** Les icônes des points forts sont saisies en admin, souvent pleines (« wallet ») : on prend leur
 *  version « outline » quand elle existe, pour le même trait que toutes les icônes du Jardin. */
const outline = (name?: string) => {
  if (!name) return undefined;
  if (name.endsWith('-outline')) return name;
  const o = `${name}-outline`;
  return o in Ionicons.glyphMap ? o : name;
};
/** Fond sombre (jardin de nuit) → icônes de la barre d'état claires. */
const isDarkBg = () => { const h = G.bg.replace('#', ''); const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255; return 0.299 * v(0) + 0.587 * v(2) + 0.114 * v(4) < 0.5; };

/* Les points forts (textes admin) prennent, dans l'ordre, les couleurs des parties de l'arbre. */
const FEATURE_KINDS: GardenIconKey[] = ['water', 'roots', 'fruits', 'flowers', 'cabin'];

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

          <GardenScene state={HERO} options={{ mood: 'joy', marks: false, label: 'Un arbre en fruits, ses racines, son arrosoir et Pépin le hérisson qui salue' }} />

          <View style={{ gap: 6, alignItems: 'center' }}>
            <GardenText variant="display" center style={{ fontSize: 28, lineHeight: 34 }}>{L.mobileTagline}</GardenText>
            <GardenText variant="body" color={G.inkSoft} center>{L.mobileSubtag}</GardenText>
          </View>

          <View style={{ gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: 20, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg }}>
            {L.mobileCtaTitle ? <GardenText variant="heading" center>{L.mobileCtaTitle}</GardenText> : null}
            {L.mobileCtaText ? <GardenText variant="small" color={G.inkSoft} center style={{ marginBottom: 4 }}>{L.mobileCtaText}</GardenText> : null}
            <GardenButton label={L.mobileCtaPrimaryLabel} onPress={() => go('/login')} />
            <GardenButton label={L.mobileCtaSecondaryLabel} variant="secondary" onPress={() => go('/register')} />
          </View>

          {L.mobileFeatures.length ? (
            <View style={{ backgroundColor: G.card, borderRadius: 20, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>
              {L.mobileFeatures.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, padding: GARDEN_SPACE.lg, borderTopWidth: i ? 1 : 0, borderTopColor: G.line }}>
                  <GardenIcon kind={FEATURE_KINDS[i % FEATURE_KINDS.length]} icon={outline(f.icon)} />
                  <View style={{ flex: 1 }}>
                    <GardenText variant="bodyStrong">{f.title}</GardenText>
                    <GardenText variant="small" color={G.inkSoft}>{f.text}</GardenText>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {hasSocials ? (
            <View pointerEvents={preview ? 'none' : 'auto'}><SocialLinks config={L.socials} color={G.muted} align="center" /></View>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
