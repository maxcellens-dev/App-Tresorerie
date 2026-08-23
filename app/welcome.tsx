import { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Animated, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useBrandColors } from '../hooks/theme/useBrandColors';
import { useAppNameFontStyle, useAppNameFontReady, APP_NAME_TEXT_PROPS } from '../hooks/theme/useBrandFont';
import { useLandingConfig, DEFAULT_LANDING } from '../hooks/config/useLandingConfig';
import { signalAppReady } from '../lib/platform/splashGate';
import LandingPage from '../components/marketing/LandingPage';
import PlayStoreBadge from '../components/marketing/PlayStoreBadge';
import SocialLinks from '../components/marketing/SocialLinks';

/** Attente MAXIMALE avant de révéler l'accueil (police de marque + textes admin). Cf. `canReveal`. */
const REVEAL_CAP_MS = 700;


export default function WelcomeScreen() {
  const COLORS = useBrandColors();
  const appNameFontStyle = useAppNameFontStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  /* Les deux halos décoratifs sont dimensionnés à 80 % de la largeur. Elle était lue UNE FOIS au
     chargement du module (`Dimensions.get('window')`) : après une rotation d'écran, un passage en
     écran partagé ou un simple redimensionnement de fenêtre sur navigateur, les halos gardaient la
     taille de l'ancienne largeur — soit deux disques verts qui débordent, soit deux pastilles
     perdues dans un coin. On suit la largeur RÉELLE. */
  const styles = useMemo(() => makeStyles(COLORS, winWidth), [COLORS, winWidth]);
  const { data: landing } = useLandingConfig();
  const L = landing ?? DEFAULT_LANDING; // config admin (avec défauts) → rien en dur sur l'accueil mobile
  // Bas de page : badge store (web seulement) et réseaux sociaux — on ne pose la rangée que s'il
  // y a réellement quelque chose dedans.
  const showStoreBadge = Platform.OS === 'web' && !!L.androidStoreUrl;
  const hasSocials = !!L.socials?.enabled && (L.socials.items ?? []).some((s) => (s.url ?? '').trim().length > 0);
  const featColors = [COLORS.emerald, COLORS.accent, COLORS.text, COLORS.emerald];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Sur web large (bureau) : page d'accueil marketing dédiée (≠ mobile), si activée en admin.
  const showLanding = Platform.OS === 'web' && winWidth >= 980 && (landing?.enabled ?? true);

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
    if (signingOut) { setCapReached(false); return; }
    const t = setTimeout(() => setCapReached(true), REVEAL_CAP_MS);
    return () => clearTimeout(t);
  }, [signingOut]);
  /* Web exclu de l'attente : le navigateur remplace la police tout seul (`font-display`), et rien
     ne couvre le premier rendu là-bas — on afficherait une page vide au lieu d'éviter un saut. */
  const canReveal = !signingOut && (Platform.OS === 'web' || (fontReady && configReady) || capReached);

  useEffect(() => {
    if (!canReveal) return;
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
  }, [canReveal]);

  if (showLanding) return <LandingPage />;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <View style={styles.background}>
        <LinearGradient
          colors={[COLORS.emerald + '4D', COLORS.emerald + '1A', COLORS.bg, COLORS.bg]}
          locations={[0, 0.25, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          {/* TOUT le contenu passe par ce fondu, carte de connexion comprise : elle restait visible
              pendant que le reste apparaissait, ce qui exposait à nouveau le changement de police. */}
          <Animated.View style={{ opacity: fadeAnim }}>

          <Animated.View style={[styles.hero, { transform: [{ translateY: slideAnim }] }]}>
            <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />

            <Text {...APP_NAME_TEXT_PROPS} style={[styles.appName, appNameFontStyle]}>{L.brandName}</Text>
            {/* Accroche BÉNÉFICE (éditable en admin → « Page d'accueil » section Mobile). */}
            <Text style={styles.tagline}>{L.mobileTagline}</Text>
            {/* Deux lignes autorisées : `adjustsFontSizeToFit` n'existe PAS sur react-native-web —
                le texte y était simplement coupé par des points de suspension dès que l'écran était
                un peu étroit (ou le libellé un peu long, il est éditable en admin). En laissant
                passer à la ligne, il tient partout ; sur mobile, la réduction automatique joue
                encore et évite d'atteindre la seconde ligne. */}
            <Text
              {...APP_NAME_TEXT_PROPS}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[styles.subtag, appNameFontStyle]}
            >{L.mobileSubtag}</Text>
          </Animated.View>

          <View style={styles.ctaContainer}>
            <View style={styles.ctaCard}>
              <Text style={styles.ctaTitle}>{L.mobileCtaTitle}</Text>
              <Text style={styles.ctaText}>{L.mobileCtaText}</Text>

              <View style={styles.ctaButtons}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push('/login')}
                  accessibilityRole="button"
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryLabel}>{L.mobileCtaPrimaryLabel}</Text>
                  <Ionicons name="arrow-forward" size={20} color={COLORS.bg} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.push('/register')}
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
                  <Ionicons name={(f.icon || 'sparkles') as any} size={24} color={featColors[i % featColors.length]} />
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
              <SocialLinks config={L.socials} color={COLORS.textSecondary} align="center" />
            </View>
          )}

          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any, width: number) {
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
    fontFamily: 'Arial Rounded MT Bold',
  },
  tagline: {
    fontSize: 18,
    color: c.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  subtag: {
    fontSize: 13,
    color: c.emerald,
    marginTop: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'Arial Rounded MT Bold',
    // Largeur bornée + centrage → l'auto-ajustement peut réduire la police pour tenir sur 1 ligne,
    // quelle que soit la police chargée (fini le « SÉRÉNITÉ » coupé quand la police de marque tarde).
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 19, // deux lignes lisibles quand le passage à la ligne est nécessaire (web)
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
    fontSize: 20,
    fontWeight: '700',
    color: c.text,
    marginBottom: 8,
  },
  ctaText: {
    fontSize: 15,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  ctaButtons: {
    width: '100%',
    gap: 12,
  },
  // Badge Play Store + réseaux : côte à côte s'il y a la place, l'un sous l'autre sinon.
  storeBadgeRow: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 14 },
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
    fontSize: 16,
    fontWeight: '700',
    color: c.bg,
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
    fontSize: 16,
    fontWeight: '600',
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
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginBottom: 4,
  },
  featureText: {
    fontSize: 14,
    color: c.textSecondary,
    lineHeight: 20,
  },
});
}