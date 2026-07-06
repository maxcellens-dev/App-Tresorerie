/**
 * LegalLayout — habillage commun des pages publiques (Confidentialité, Mentions légales).
 *
 * Deux présentations, selon la LARGEUR (bureau vs mobile), pas la plateforme :
 *  • Bureau (web large ≥ 900 px) → en-tête + pied de page « site web » (logo, Connexion/
 *    Inscription) : ces pages sont aussi accessibles publiquement depuis la page d'accueil.
 *  • Mobile / app (largeur < 900 px ou natif) → en-tête D'APP identique aux autres pages
 *    (barre « Relyka » + série/gemmes/avatar, puis flèche « Retour » + titre).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, useWindowDimensions } from 'react-native';
import ScreenGradient from './ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { usePublicColors } from '../hooks/usePublicColors';
import { useAppNameFont, APP_NAME_TEXT_PROPS } from '../hooks/useBrandFont';
import { useLandingConfig, DEFAULT_LANDING } from '../hooks/useLandingConfig';
import { useNavBack } from '../hooks/useNavBack';
import HeaderWithProfile from './HeaderWithProfile';

/** Seuil « bureau » : au-delà, on affiche l'habillage site web ; en-dessous, l'app. */
export const LEGAL_DESKTOP_MIN_WIDTH = 900;

export default function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const { user } = useAuth();
  // Connecté → préférence perso ; public → thème de la vitrine (clair/sombre).
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const { data: landing } = useLandingConfig();
  const L = landing ?? DEFAULT_LANDING; // même config que la page d'accueil (rien en dur)
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= LEGAL_DESKTOP_MIN_WIDTH;
  const goBack = useNavBack();
  // Même résolveur de liens que la page d'accueil (ancre → route, URL → nouvel onglet).
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

  // ───────── Mode « site web » (bureau) ─────────
  if (isDesktopWeb) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          {/* En-tête site */}
          <View style={styles.siteHeader}>
            <View style={styles.siteHeaderInner}>
              <TouchableOpacity style={styles.brandRow} onPress={() => router.replace(user ? '/(tabs)/pilotage' : '/welcome')} activeOpacity={0.8}>
                <Image source={require('../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
                <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, { fontFamily: appNameFont }]}>{L.brandName}</Text>
              </TouchableOpacity>
              <View style={styles.siteHeaderBtns}>
                {user ? (
                  <TouchableOpacity style={styles.siteCta} onPress={() => router.replace('/(tabs)/pilotage')} activeOpacity={0.85}>
                    <Text style={styles.siteCtaText}>Mon espace</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity onPress={() => router.push('/login')}>
                      <Text style={styles.siteNavLink}>Se connecter</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.siteCta} onPress={() => router.push('/register')} activeOpacity={0.85}>
                      <Text style={styles.siteCtaText}>S'inscrire</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>

          {/* Contenu */}
          <View style={styles.siteBody}>
            <View style={styles.contentWrap}>
              <TouchableOpacity style={styles.backRow} onPress={goBack} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
                <Text style={styles.backText}>Retour</Text>
              </TouchableOpacity>
              <Text style={styles.pageTitle}>{title}</Text>
              {children}
            </View>
          </View>

          {/* Pied de page site — IDENTIQUE à la page d'accueil (config admin). */}
          <View style={styles.siteFooter}>
            <Text {...APP_NAME_TEXT_PROPS} style={[styles.footerBrand, { fontFamily: appNameFont }]}>{L.brandName}</Text>
            <Text style={styles.footerText}>{L.footerText}</Text>
            <View style={styles.footerLinks}>
              {L.footerLinks.map((l) => (
                <TouchableOpacity key={l.label} onPress={() => goAnchor(l)} activeOpacity={0.7}><Text style={styles.footerLink}>{l.label}</Text></TouchableOpacity>
              ))}
            </View>
            <Text style={styles.footerCopy}>© {new Date().getFullYear()} {L.brandName}. Tous droits réservés.</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ───────── Mode « app » (mobile / natif) : en-tête identique aux autres pages ─────────
  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView edges={['top']}>
        <HeaderWithProfile title="Relyka" />
      </SafeAreaView>
      <SafeAreaView style={styles.appSafe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.appBackRow} onPress={goBack} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.appBackText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.appTitle}>{title}</Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {children}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    contentWrap: { width: '100%', maxWidth: 860, alignSelf: 'center' },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
    backText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
    pageTitle: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 6 },

    // Site header
    siteHeader: { borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.bg },
    siteHeaderInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, maxWidth: 1200, width: '100%', alignSelf: 'center', gap: 12 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    brandLogo: { width: 34, height: 34, borderRadius: 8 },
    brand: { fontSize: 24, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    siteHeaderBtns: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    siteNavLink: { fontSize: 15, fontWeight: '600', color: c.textSecondary, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    siteCta: { backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    siteCtaText: { fontSize: 14, fontWeight: '700', color: c.bg },

    // Site body
    siteBody: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },

    // Site footer
    siteFooter: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingHorizontal: 24, paddingVertical: 44, alignItems: 'center', gap: 10 },
    footerBrand: { fontSize: 22, fontWeight: '800', color: c.text },
    footerText: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 6, justifyContent: 'center' },
    footerLink: { fontSize: 14, fontWeight: '600', color: c.emerald, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    footerCopy: { fontSize: 12, color: c.textSecondary, marginTop: 12 },

    // App mode (mobile/natif) — calé sur les autres pages (ex. Apparence)
    appSafe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    appBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, alignSelf: 'flex-start' },
    appBackText: { fontSize: 14, fontWeight: '600', color: c.text },
    appTitle: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 },
  });
}
