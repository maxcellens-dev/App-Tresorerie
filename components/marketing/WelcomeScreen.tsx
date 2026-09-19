import { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Animated, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useBrandColors } from '../../hooks/theme/useBrandColors';
import { useAppNameFontStyle, useAppNameFontReady, useBodyFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import { marketingTypography as type } from '../../theme/marketingTypography';
import type { TextStyle } from 'react-native';
import { useLandingConfig, mergeLanding, type LandingConfig } from '../../hooks/config/useLandingConfig';
import { signalAppReady } from '../../lib/platform/splashGate';
import LandingPage from './LandingPage';
import PlayStoreBadge from './PlayStoreBadge';
import SocialLinks from './SocialLinks';

/** Attente MAXIMALE avant de révéler l'accueil (police de marque + textes admin). Cf. `canReveal`. */
const REVEAL_CAP_MS = 700;


/** Shared native welcome screen; preview uses the same layout without navigation or boot effects. */
export default function WelcomeScreen({ previewConfig, previewWidth }: { previewConfig?: LandingConfig; previewWidth?: number } = {}) {
  const COLORS = useBrandColors(previewConfig?.theme);
  const appNameFontStyle = useAppNameFontStyle();
  const bodyFontStyle = useBodyFontStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const winWidth = previewWidth ?? windowWidth;
  /* Les deux halos décoratifs sont dimensionnés à 80 % de la largeur. Elle était lue UNE FOIS au
     chargement du module (`Dimensions.get('window')`) : après une rotation d'écran, un passage en
     écran partagé ou un simple redimensionnement de fenêtre sur navigateur, les halos gardaient la
     taille de l'ancienne largeur — soit deux disques verts qui débordent, soit deux pastilles
     perdues dans un coin. On suit la largeur RÉELLE. */
  const styles = useMemo(() => makeStyles(COLORS, winWidth, bodyFontStyle), [COLORS, winWidth, bodyFontStyle.fontFamily, bodyFontStyle.fontWeight]);
  const { data: landing } = useLandingConfig();
  const L = useMemo(() => mergeLanding(previewConfig ?? landing), [previewConfig, landing]); // config admin (avec défauts) → rien en dur sur l'accueil mobile
  // Bas de page : badge store (web seulement) et réseaux sociaux — on ne pose la rangée que s'il
  // y a réellement quelque chose dedans.
  const showStoreBadge = !previewConfig && Platform.OS === 'web' && !!L.androidStoreUrl;
  const hasSocials = !!L.socials?.enabled && (L.socials.items ?? []).some((s) => (s.url ?? '').trim().length > 0);
  const fadeAnim = useRef(new Animated.Value(previewConfig ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(previewConfig ? 0 : 50)).current;

  // Landing responsive sur navigateur ; l'accueil natif reste indépendant.
  const showLanding = !previewConfig && Platform.OS === 'web' && (landing?.enabled ?? true);

  /* ── NE RIEN MONTRER QUI VA CHANGER SOUS LES YEUX ──────────────────────────────────────────────
     Deux choses arrivent en retard sur cet écran : la police du nom (importée → chargée en
     asynchrone sur natif) et les textes eux-mêmes (config admin `landing`). Le contenu s'affichait
     aussitôt, puis les titres SAUTAIENT en changeant de police.

     Le cas le plus visible est la DÉCONNEXION, et il n'est pas dû au réseau : `signOut()` fait
     `queryClient.clear()`, donc la config de style et les textes DISPARAISSENT juste avant que le
     voile ne se lève (cf. components/SignOutVeil). L'accueil se découvrait alors avec la police de
     repli et les textes par défaut, puis tout se remettait en place à la relecture — pile sous les
     yeux. D'où les trois conditions ci-dessous, et surtout `signingOut` : tant que la purge est en
     cours, rien de ce qu'on affiche n'est définitif.

     ⚠️ Plafond OBLIGATOIRE (REVEAL_CAP_MS) : hors-ligne, ni la config ni la police n'arriveront
     jamais — au pire on retombe sur l'ancien comportement, jamais sur une page vide. Il ne court
     qu'une fois le voile parti : le dépenser dessous ne servirait à rien (c'est déjà masqué). */
  const { signingOut } = useAuth();
  const fontReady = useAppNameFontReady();
  const configReady = landing !== undefined;
  const [capReached, setCapReached] = useState(false);
  useEffect(() => {
    if (previewConfig) return;
    if (signingOut) { setCapReached(false); return; }
    const t = setTimeout(() => setCapReached(true), REVEAL_CAP_MS);
    return () => clearTimeout(t);
  }, [signingOut, previewConfig]);
  /* Web exclu de l'attente : le navigateur remplace la police tout seul (`font-display`), et rien
     ne couvre le premier rendu là-bas — on afficherait une page vide au lieu d'éviter un saut. */
  const canReveal = !signingOut && (Platform.OS === 'web' || (fontReady && configReady) || capReached);

  useEffect(() => {
    if (previewConfig || !canReveal) return;
    // Le splash animé n'est libéré qu'ici : sur un démarrage à froid, c'est LUI qui couvre l'attente
    // (au lieu de révéler une page dont les titres vont encore bouger).
    signalAppReady();
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [canReveal, previewConfig]);

  if (showLanding) return <LandingPage />;

  return (
    <View style={styles.root}>
      {!previewConfig && <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />}
      <View style={styles.background}>
        <LinearGradient
          colors={[COLORS.emerald + '4D', COLORS.emerald + '1A', COLORS.bg, COLORS.bg]}
          locations={[0, 0.25, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <SafeAreaView style={styles.safe} edges={previewConfig ? [] : ['top']}>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + (previewConfig ? 0 : insets.bottom) }]} showsVerticalScrollIndicator={false}>
          {/* TOUT le contenu passe par ce fondu, carte de connexion comprise : elle restait visible
              pendant que le reste apparaissait, ce qui exposait à nouveau le changement de police. */}
          <Animated.View style={{ opacity: fadeAnim }}>

          <Animated.View style={[styles.hero, { transform: [{ translateY: slideAnim }] }]}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />

            <Text {...APP_NAME_TEXT_PROPS} style={[styles.appName, appNameFontStyle]}>{L.brandName}</Text>
            {/* Accroche BÉNÉFICE (éditable en admin → « Page d'accueil » section Mobile). */}
            <Text style={styles.tagline}>{L.mobileTagline}</Text>
            {/* Deux lignes autorisées : `adjustsFontSizeToFit` n'existe PAS sur react-native-web —
                le texte y était simplement coupé par des points de suspension dès que l'écran était
                un peu étroit (ou le libellé un peu long, il est éditable en admin). En laissant
                passer à la ligne, il tient partout ; sur mobile, la réduction automatique joue
                encore et évite d'atteindre la seconde ligne. */}
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={styles.subtag}
            >{L.mobileSubtag}</Text>
          </Animated.View>

          <View style={styles.ctaContainer}>
            <View style={styles.ctaCard}>
              <Text style={styles.ctaTitle}>{L.mobileCtaTitle}</Text>
              <Text style={styles.ctaText}>{L.mobileCtaText}</Text>

              <View style={styles.ctaButtons}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => !previewConfig && router.push('/login')}
                  accessibilityRole="button"
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryLabel}>{L.mobileCtaPrimaryLabel}</Text>
                  <Ionicons name="arrow-forward" size={20} color={COLORS.onAccent} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => !previewConfig && router.push('/register')}
                  accessibilityRole="button"
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryLabel}>{L.mobileCtaSecondaryLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Fonctionnalités PHARES — éditables en admin (section Mobile). */}
          <Animated.View style={[styles.features, { transform: [{ translateY: slideAnim }] }]}>
            {L.mobileFeatures.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons name={(f.icon || 'sparkles') as any} size={24} color={COLORS.emerald} />
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              </View>
            ))}
          </Animated.View>

          {/* Bas de page : le badge Play Store (web uniquement — redondant dans l'app native) et
              les réseaux sociaux. En web mobile ils cohabitent sur la même rangée ; dans l'app
              native, les réseaux sont seuls. Rien à montrer → pas de rangée vide. */}
          {(showStoreBadge || hasSocials) && (
            <View style={styles.storeBadgeRow}>
              {showStoreBadge && <PlayStoreBadge url={L.androidStoreUrl} size="sm" />}
              <View pointerEvents={previewConfig ? "none" : "auto"}><SocialLinks config={L.socials} color={COLORS.textSecondary} align="center" /></View>
            </View>
          )}

          {/* Textes légaux — ils n'existaient QUE dans le pied de page de la version bureau du site
              (components/marketing/LandingPage). Sur un téléphone, et sur un navigateur étroit, on
              arrivait donc sur l'écran d'inscription sans avoir jamais pu ouvrir la politique de
              confidentialité : ni ici, ni sur « Se connecter », ni sur « Créer un compte ». */}
          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => !previewConfig && router.push('/confidentialite' as any)} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.legalLink}>Confidentialité</Text>
            </TouchableOpacity>
            <Text style={styles.legalSep}>·</Text>
            <TouchableOpacity onPress={() => !previewConfig && router.push('/legal' as any)} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.legalLink}>Mentions légales</Text>
            </TouchableOpacity>
          </View>

          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any, width: number, bodyFont: TextStyle) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  background: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
  },
  glowTop: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: c.emerald + '22',
    transform: [{ scaleX: 1.5 }],
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    right: -100,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: c.emerald + '10',
    transform: [{ scaleX: 1.5 }],
  },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 20 },
  
  hero: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 48,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.emerald + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: c.emerald + '33',
  },
  logo: {
    width: 104,
    height: 104,
    marginBottom: 20,
    borderRadius: 22,
  },
  /* Le « a » final disparaissait sur certains appareils : Android dessine un <Text> dans sa largeur
     MESURÉE (somme des chasses), or les polices de marque arrondies/grasses chargées par le Style
     Editor débordent de cette largeur sur la dernière lettre — et la chasse négative rognait encore
     le compte. On rend donc la boîte plus large que le texte (bande pleine + centrage + marge
     latérale) et on laisse la lettre finale respirer plutôt que d'être coupée au ras. */
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: c.text,
    letterSpacing: 0,
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  tagline: {
    ...type.title,
    ...bodyFont,
    color: c.text,
    marginTop: 12,
    textAlign: 'center',
  },
  subtag: {
    ...type.eyebrow,
    ...bodyFont,
    color: c.textSecondary,
    marginTop: 8,
    textTransform: 'uppercase',
    // Largeur bornée + centrage → l'auto-ajustement peut réduire la police pour tenir sur 1 ligne,
    // quelle que soit la police chargée (fini le « SÉRÉNITÉ » coupé quand la police de marque tarde).
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  ctaContainer: {
    marginBottom: 48,
  },
  ctaCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    ...({ backdropFilter: 'blur(10px)' } as any),
  },
  ctaTitle: {
    ...type.title,
    ...bodyFont,
    color: c.text,
    marginBottom: 8,
  },
  ctaText: {
    ...type.body,
    ...bodyFont,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  ctaButtons: {
    width: '100%',
    gap: 12,
  },
  // Badge Play Store + réseaux : côte à côte s'il y a la place, l'un sous l'autre sinon.
  storeBadgeRow: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 14 },
  legalRow: { marginTop: 22, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
  legalLink: { ...type.caption, ...bodyFont, color: c.textSecondary, textDecorationLine: 'underline' },
  legalSep: { ...type.caption, ...bodyFont, color: c.textSecondary },
  primaryBtn: {
    backgroundColor: c.emerald,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: c.emerald,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryLabel: {
    ...type.primaryLabel,
    ...bodyFont,
    color: c.onAccent,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  secondaryLabel: {
    ...type.secondaryLabel,
    ...bodyFont,
    color: c.text,
  },

  features: {
    gap: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    backgroundColor: c.card,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  featureContent: {
    flex: 1,
    justifyContent: 'center',
  },
  featureTitle: {
    ...type.featureTitle,
    ...bodyFont,
    color: c.text,
    marginBottom: 4,
  },
  featureText: {
    ...type.smallBody,
    ...bodyFont,
    color: c.textSecondary,
  },
});
}
