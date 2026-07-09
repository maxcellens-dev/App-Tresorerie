import { useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Animated, Dimensions, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { useBrandColors } from '../hooks/useBrandColors';
import { useAppNameFont, APP_NAME_TEXT_PROPS } from '../hooks/useBrandFont';
import { useLandingConfig, DEFAULT_LANDING } from '../hooks/useLandingConfig';
import { signalAppReady } from '../lib/splashGate';
import LandingPage from '../components/LandingPage';
import PlayStoreBadge from '../components/PlayStoreBadge';

const { width } = Dimensions.get('window');


export default function WelcomeScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const { data: landing } = useLandingConfig();
  const L = landing ?? DEFAULT_LANDING; // config admin (avec défauts) → rien en dur sur l'accueil mobile
  const featColors = [COLORS.emerald, COLORS.accent, COLORS.text, COLORS.emerald];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Sur web large (bureau) : page d'accueil marketing dédiée (≠ mobile), si activée en admin.
  const showLanding = Platform.OS === 'web' && winWidth >= 980 && (landing?.enabled ?? true);

  // Écran de destination (non connecté) prêt immédiatement → libère le splash animé.
  useEffect(() => { signalAppReady(); }, []);

  useEffect(() => {
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
  }, []);

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
          
          <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />

            <Text {...APP_NAME_TEXT_PROPS} style={[styles.appName, { fontFamily: appNameFont }]}>{L.brandName}</Text>
            {/* Accroche BÉNÉFICE (éditable en admin → « Page d'accueil » section Mobile). */}
            <Text style={styles.tagline}>{L.mobileTagline}</Text>
            <Text
              {...APP_NAME_TEXT_PROPS}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[styles.subtag, { fontFamily: appNameFont }]}
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
              {/* Badge Play Store — web uniquement (redondant dans l'app native déjà installée). */}
              {Platform.OS === 'web' && !!L.androidStoreUrl && (
                <View style={styles.storeBadgeRow}>
                  <PlayStoreBadge url={L.androidStoreUrl} size="sm" />
                </View>
              )}
            </View>
          </View>

          {/* Fonctionnalités PHARES — éditables en admin (section Mobile). */}
          <Animated.View style={[styles.features, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
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

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  background: {
    ...StyleSheet.absoluteFillObject,
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
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: c.text,
    letterSpacing: -1,
    textAlign: 'center',
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
  storeBadgeRow: { marginTop: 16, alignItems: 'center' },
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