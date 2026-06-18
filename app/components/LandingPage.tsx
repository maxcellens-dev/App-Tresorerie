/**
 * LandingPage — page d'accueil « bureau » (marketing web), affichée sur web large.
 * Entièrement personnalisable en admin via app_config.landing (useLandingConfig).
 * Les boutons « S'inscrire » / « Se connecter » mènent aux pages /register et /login.
 */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Animated, Image, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useBrandColors } from '../hooks/useBrandColors';
import { useAppNameFont } from '../hooks/useBrandFont';
import { useLandingConfig } from '../hooks/useLandingConfig';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';

export default function LandingPage() {
  // Le mode (clair/sombre) suit app_config.landing.theme via useBrandColors.
  const COLORS = useBrandColors();
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data: cfg } = useLandingConfig();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = Boolean(profile?.is_admin);

  const wide = width >= 980;
  const styles = makeStyles(COLORS, wide);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(40)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(slide, { toValue: 0, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: -1, duration: 2200, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(float, { toValue: 0, duration: 2200, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    ).start();
  }, []);

  const floatY = float.interpolate({ inputRange: [-1, 0], outputRange: [-10, 0] });

  const goAnchor = (link: { anchor?: string; url?: string }) => {
    if (link.url) { if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(link.url, '_blank'); return; }
    if (link.anchor === 'login') return router.push('/login');
    if (link.anchor === 'register') return router.push('/register');
    if (link.anchor === 'confidentialite') return router.push('/confidentialite');
    if (link.anchor === 'legal') return router.push('/legal');
    if (Platform.OS === 'web' && typeof document !== 'undefined' && link.anchor) {
      document.getElementById(link.anchor)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (!cfg) return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />

      {/* ── En-tête / menu ── */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.brandRow}>
            <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
            <Text style={[styles.brand, { fontFamily: appNameFont }]}>{cfg.brandName}</Text>
          </View>
          <View style={styles.headerBtns}>
            <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.8} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>{cfg.ctaSecondaryLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/register')} activeOpacity={0.85} style={styles.solidBtn}>
              <Text style={styles.solidBtnText}>{cfg.ctaPrimaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Héros ── */}
        <View style={styles.heroBg}>
          <LinearGradient
            colors={[COLORS.emerald + '33', COLORS.emerald + '0D', COLORS.bg, COLORS.bg]}
            locations={[0, 0.3, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.glow} />
        </View>

        <Animated.View style={[styles.hero, { opacity: fade, transform: [{ translateY: slide }] }]}>
          <View style={styles.heroText}>
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>{cfg.heroBadge}</Text>
            </View>
            <Text style={styles.heroTitle}>{cfg.heroTitle}</Text>
            <Text style={styles.heroSubtitle}>{cfg.heroSubtitle}</Text>
            <View style={styles.heroBtns}>
              <TouchableOpacity onPress={() => router.push('/register')} activeOpacity={0.85} style={styles.heroPrimary}>
                <Text style={styles.heroPrimaryText}>{cfg.ctaPrimaryLabel}</Text>
                <Ionicons name="arrow-forward" size={20} color={COLORS.bg} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.8} style={styles.heroSecondary}>
                <Text style={styles.heroSecondaryText}>{cfg.ctaSecondaryLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Visuel : image admin OU maquette stylée façon app */}
          <Animated.View style={[styles.heroVisual, { transform: [{ translateY: floatY }] }]}>
            {cfg.heroImage ? (
              <Image source={{ uri: cfg.heroImage }} style={styles.heroImage} resizeMode="cover" />
            ) : (
              <View style={styles.mockCard}>
                <Text style={styles.mockLabel}>{cfg.heroBalanceLabel}</Text>
                <Text style={[styles.mockValue, { fontFamily: appNameFont }]}>{cfg.heroBalanceValue}</Text>
                <View style={styles.mockBarTrack}><View style={styles.mockBarFill} /></View>
                <View style={styles.mockTx}>
                  <View style={styles.mockTxIcon}><Ionicons name="cash-outline" size={18} color={COLORS.emerald} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mockTxLabel}>{cfg.heroTxLabel}</Text>
                    <Text style={styles.mockTxDate}>Aujourd'hui</Text>
                  </View>
                  <Text style={styles.mockTxAmount}>{cfg.heroTxAmount}</Text>
                </View>
              </View>
            )}
          </Animated.View>
        </Animated.View>

        {/* ── Fonctionnalités ── */}
        <View nativeID="features" style={styles.section}>
          <Text style={styles.sectionTitle}>{cfg.featuresTitle}</Text>
          <Text style={styles.sectionSubtitle}>{cfg.featuresSubtitle}</Text>
          <View style={styles.featuresGrid}>
            {cfg.features.map((f) => (
              <View key={f.title} style={styles.featureCard}>
                <View style={styles.featureIcon}><Ionicons name={(f.icon || 'sparkles') as any} size={24} color={COLORS.emerald} /></View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Statistiques ── */}
        <View nativeID="stats" style={styles.statsBand}>
          {cfg.stats.map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* ── CTA final ── */}
        <View nativeID="final" style={styles.finalSection}>
          <View style={styles.finalCard}>
            <Text style={styles.finalTitle}>{cfg.finalTitle}</Text>
            <Text style={styles.finalSubtitle}>{cfg.finalSubtitle}</Text>
            <View style={styles.heroBtns}>
              <TouchableOpacity onPress={() => router.push('/register')} activeOpacity={0.85} style={styles.heroPrimary}>
                <Text style={styles.heroPrimaryText}>{cfg.ctaPrimaryLabel}</Text>
                <Ionicons name="arrow-forward" size={20} color={COLORS.bg} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.8} style={styles.heroSecondary}>
                <Text style={styles.heroSecondaryText}>{cfg.ctaSecondaryLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Pied de page ── */}
        <View style={styles.footer}>
          <Text style={[styles.footerBrand, { fontFamily: appNameFont }]}>{cfg.brandName}</Text>
          <Text style={styles.footerText}>{cfg.footerText}</Text>
          <View style={styles.footerLinks}>
            {cfg.footerLinks.map((l) => (
              <TouchableOpacity key={l.label} onPress={() => goAnchor(l)} activeOpacity={0.7}>
                <Text style={styles.footerLink}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.footerCopy}>© {new Date().getFullYear()} {cfg.brandName}. Tous droits réservés.</Text>
        </View>
      </ScrollView>

      {/* Édition réservée admin (visible si connecté en admin) */}
      {isAdmin && (
        <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/(tabs)/(secondary)/admin/landing' as any)} activeOpacity={0.85}>
          <Ionicons name="create-outline" size={18} color={COLORS.bg} />
          <Text style={styles.editBtnText}>Éditer la page</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(c: any, wide: boolean) {
  const PAD = wide ? 64 : 22;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.bg + 'F2', zIndex: 10, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0 } as any : {}) },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PAD, paddingVertical: 14, maxWidth: 1200, width: '100%', alignSelf: 'center', gap: 12 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    brandLogo: { width: 34, height: 34, borderRadius: 8 },
    brand: { fontSize: 24, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    nav: { flexDirection: 'row', gap: 28, flex: 1, justifyContent: 'center' },
    navLink: { fontSize: 15, fontWeight: '600', color: c.textSecondary, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ghostBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10 },
    ghostBtnText: { fontSize: 14, fontWeight: '700', color: c.text },
    solidBtn: { backgroundColor: c.emerald, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
    solidBtnText: { fontSize: 14, fontWeight: '800', color: c.bg },

    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 0 },

    heroBg: { ...StyleSheet.absoluteFillObject, height: 720, zIndex: -1 },
    glow: { position: 'absolute', top: -120, alignSelf: 'center', width: 700, height: 700, borderRadius: 350, backgroundColor: c.emerald + '18' },

    hero: { flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 48 : 36, paddingHorizontal: PAD, paddingTop: wide ? 80 : 48, paddingBottom: wide ? 90 : 56, maxWidth: 1200, width: '100%', alignSelf: 'center' },
    heroText: { flex: wide ? 1 : undefined, width: wide ? undefined : '100%' },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: c.emerald + '1A', borderWidth: 1, borderColor: c.emerald + '40', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, marginBottom: 22 },
    badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.emerald },
    badgeText: { fontSize: 13, fontWeight: '700', color: c.emerald },
    heroTitle: { fontSize: wide ? 56 : 38, lineHeight: wide ? 62 : 44, fontWeight: '800', color: c.text, letterSpacing: -1.5, marginBottom: 20 },
    heroSubtitle: { fontSize: wide ? 19 : 16, lineHeight: wide ? 29 : 24, color: c.textSecondary, fontWeight: '500', marginBottom: 30, maxWidth: 560 },
    heroBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center' },
    heroPrimary: { backgroundColor: c.emerald, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 28, borderRadius: 14, shadowColor: c.emerald, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 6 },
    heroPrimaryText: { fontSize: 17, fontWeight: '800', color: c.bg },
    heroSecondary: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder },
    heroSecondaryText: { fontSize: 17, fontWeight: '700', color: c.text },

    heroVisual: { flex: wide ? 1 : undefined, width: wide ? undefined : '100%', alignItems: 'center', justifyContent: 'center' },
    heroImage: { width: '100%', maxWidth: 460, height: 460, borderRadius: 28, borderWidth: 1, borderColor: c.cardBorder },
    mockCard: { width: '100%', maxWidth: 420, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 28, padding: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.25, shadowRadius: 40, elevation: 10 },
    mockLabel: { fontSize: 14, color: c.textSecondary, fontWeight: '600' },
    mockValue: { fontSize: 46, fontWeight: '800', color: c.emerald, marginTop: 6, letterSpacing: -1 },
    mockBarTrack: { height: 10, borderRadius: 6, backgroundColor: c.bg, marginTop: 22, marginBottom: 22, overflow: 'hidden' },
    mockBarFill: { width: '68%', height: '100%', borderRadius: 6, backgroundColor: c.emerald },
    mockTx: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.bg, borderRadius: 16, padding: 14 },
    mockTxIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.emerald + '22', alignItems: 'center', justifyContent: 'center' },
    mockTxLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    mockTxDate: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    mockTxAmount: { fontSize: 16, fontWeight: '800', color: c.emerald },

    section: { paddingHorizontal: PAD, paddingVertical: wide ? 80 : 52, maxWidth: 1200, width: '100%', alignSelf: 'center' },
    sectionTitle: { fontSize: wide ? 40 : 28, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -1, marginBottom: 12 },
    sectionSubtitle: { fontSize: wide ? 18 : 15, color: c.textSecondary, textAlign: 'center', marginBottom: 44, maxWidth: 560, alignSelf: 'center', lineHeight: 24 },
    featuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center' },
    featureCard: { flexGrow: 1, flexBasis: wide ? '30%' : '100%', minWidth: wide ? 280 : undefined, maxWidth: wide ? 360 : undefined, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, padding: 26 },
    featureIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: c.emerald + '1A', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    featureTitle: { fontSize: 19, fontWeight: '800', color: c.text, marginBottom: 8 },
    featureText: { fontSize: 15, lineHeight: 22, color: c.textSecondary },

    statsBand: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: wide ? 80 : 36, backgroundColor: c.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.cardBorder, paddingVertical: wide ? 56 : 40, paddingHorizontal: PAD },
    statItem: { alignItems: 'center' },
    statValue: { fontSize: wide ? 48 : 36, fontWeight: '800', color: c.emerald, letterSpacing: -1 },
    statLabel: { fontSize: 15, color: c.textSecondary, fontWeight: '600', marginTop: 6 },

    finalSection: { paddingHorizontal: PAD, paddingVertical: wide ? 90 : 56, maxWidth: 1100, width: '100%', alignSelf: 'center' },
    finalCard: { backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '33', borderRadius: 28, paddingVertical: wide ? 64 : 44, paddingHorizontal: PAD, alignItems: 'center' },
    finalTitle: { fontSize: wide ? 40 : 28, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -1, marginBottom: 14 },
    finalSubtitle: { fontSize: wide ? 18 : 15, color: c.textSecondary, textAlign: 'center', marginBottom: 32, maxWidth: 520, lineHeight: 24 },

    footer: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingHorizontal: PAD, paddingVertical: 44, alignItems: 'center', gap: 12 },
    footerBrand: { fontSize: 22, fontWeight: '800', color: c.text },
    footerText: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 6 },
    footerLink: { fontSize: 14, fontWeight: '600', color: c.emerald, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    footerCopy: { fontSize: 12, color: c.textSecondary, marginTop: 12 },

    editBtn: { position: 'absolute', bottom: 24, right: 24, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emerald, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8 },
    editBtnText: { fontSize: 14, fontWeight: '800', color: c.bg },
  });
}
