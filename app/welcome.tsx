import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  accent: '#3b82f6',
};

export default function WelcomeScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.background}>
        <LinearGradient
          colors={['#0f172a', '#020617', '#020617']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.iconCircle}>
              <Ionicons name="wallet" size={48} color={COLORS.emerald} />
            </View>
            <Text style={styles.appName}>MyTreasury</Text>
            <Text style={styles.tagline}>Pilotez votre avenir financier</Text>
            <Text style={styles.subtag}>Trésorerie · Prévisions · Sérénité</Text>
          </Animated.View>

          <View style={styles.ctaContainer}>
            <View style={styles.ctaCard}>
              <Text style={styles.ctaTitle}>Prêt à commencer ?</Text>
              <Text style={styles.ctaText}>Connectez-vous pour retrouver vos comptes ou créez votre espace en quelques secondes.</Text>
              
              <View style={styles.ctaButtons}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push('/login')}
                  accessibilityRole="button"
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryLabel}>Se connecter</Text>
                  <Ionicons name="arrow-forward" size={20} color={COLORS.bg} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.push('/register')}
                  accessibilityRole="button"
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryLabel}>Créer un compte</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Animated.View style={[styles.features, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name="trending-up" size={24} color={COLORS.emerald} />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>Anticipez</Text>
                <Text style={styles.featureText}>Visualisez votre solde futur et prenez les bonnes décisions.</Text>
              </View>
            </View>
            
            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name="shield-checkmark" size={24} color={COLORS.accent} />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>Sécurisez</Text>
                <Text style={styles.featureText}>Données chiffrées et stockées localement (offline-first).</Text>
              </View>
            </View>

            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name="options" size={24} color={COLORS.text} />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>Maîtrisez</Text>
                <Text style={styles.featureText}>Catégorisation intelligente et plan de trésorerie sur mesure.</Text>
              </View>
            </View>
          </Animated.View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
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
    backgroundColor: '#34d39915',
    transform: [{ scaleX: 1.5 }],
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    right: -100,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: '#3b82f610',
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
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -1,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 18,
    color: COLORS.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  subtag: {
    fontSize: 13,
    color: COLORS.emerald,
    marginTop: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  ctaContainer: {
    marginBottom: 48,
  },
  ctaCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  ctaTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  ctaText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  ctaButtons: {
    width: '100%',
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: COLORS.emerald,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: COLORS.emerald,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.bg,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  secondaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },

  features: {
    gap: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(30, 41, 59, 0.5)',
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  featureContent: {
    flex: 1,
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  featureText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
});