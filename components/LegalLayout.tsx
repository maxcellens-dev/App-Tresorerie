/**
 * LegalLayout — habillage commun des pages publiques (Confidentialité, Mentions légales).
 *
 * TROIS présentations, choisies par `legalPresentation()` — selon la largeur ET la connexion :
 *  • `site` — visiteur PUBLIC sur écran large (≥ 900 px) → en-tête + pied de page « site web »
 *    (logo, Connexion/Inscription) : ces pages sont référencées et atteignables depuis l'accueil.
 *  • `appDesktop` — utilisateur CONNECTÉ sur écran bureau (≥ 1024 px) → la page est INTÉGRÉE à
 *    l'app : barre latérale de navigation à gauche, barre supérieure avec le profil, contenu dans
 *    une colonne de lecture. Une fois connecté, on ne ressort plus « sur le site » pour lire les
 *    mentions légales : on reste dans son espace, avec toute la navigation sous la main.
 *  • `app` — mobile, tablette et natif → en-tête D'APP identique aux autres pages (barre « Relyka »
 *    + série/gemmes/avatar, puis flèche « Retour » + titre).
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
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../hooks/useBrandFont';
import { useLandingConfig, DEFAULT_LANDING } from '../hooks/useLandingConfig';
import { useNavBack } from '../hooks/useNavBack';
import { DESKTOP_MIN_WIDTH } from '../hooks/useResponsive';
import { MAX_W } from '../lib/webLayout';
import HeaderWithProfile from './HeaderWithProfile';
import WebSideNav from './web/WebSideNav';

/** Seuil « bureau » : au-delà, un visiteur PUBLIC voit l'habillage site web. */
export const LEGAL_DESKTOP_MIN_WIDTH = 900;

export type LegalPresentation = 'site' | 'appDesktop' | 'app';

/**
 * Présentation à retenir pour une page légale. Exporté parce que `app/_layout` doit prendre la
 * MÊME décision que ce composant : c'est lui qui choisit d'enfermer la page dans la colonne d'app
 * ou de la laisser pleine largeur. Deux règles séparées finiraient forcément par diverger.
 */
export function legalPresentation(width: number, isLoggedIn: boolean): LegalPresentation {
  if (Platform.OS !== 'web') return 'app';
  // Connecté : on n'intègre à la coquille bureau qu'à partir du seuil où elle existe (1024).
  // Entre 900 et 1024, l'app tient dans sa colonne centrée → la page légale fait pareil.
  if (isLoggedIn) return width >= DESKTOP_MIN_WIDTH ? 'appDesktop' : 'app';
  return width >= LEGAL_DESKTOP_MIN_WIDTH ? 'site' : 'app';
}

export default function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const { user } = useAuth();
  // Connecté → préférence perso ; public → thème de la vitrine (clair/sombre).
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFontStyle = useAppNameFontStyle();
  const router = useRouter();
  const { data: landing } = useLandingConfig();
  const L = landing ?? DEFAULT_LANDING; // même config que la page d'accueil (rien en dur)
  const { width } = useWindowDimensions();
  const presentation = legalPresentation(width, !!user);
  const isDesktopWeb = presentation === 'site';
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

  // ───────── Mode « intégré à l'app » (bureau, connecté) ─────────
  // Même coquille que le reste de l'app : barre latérale + barre supérieure. La page n'est plus une
  // sortie hors de l'espace personnel, c'est une page de plus dans l'espace personnel.
  if (presentation === 'appDesktop') {
    return (
      <View style={styles.appDesktopShell}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <WebSideNav />
        <View style={styles.appDesktopMain}>
          {/* En PREMIER : le dégradé est en absoluteFill, il doit passer DERRIÈRE l'en-tête. */}
          <ScreenGradient />
          <HeaderWithProfile title={title} desktop height={68} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.appDesktopScroll}>
            <View style={styles.appDesktopColumn}>
              <TouchableOpacity style={styles.backRow} onPress={goBack} activeOpacity={0.7} accessibilityRole="button">
                <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
                <Text style={styles.backText}>Retour</Text>
              </TouchableOpacity>
              {children}
              <View style={{ height: 48 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    );
  }

  // ───────── Mode « site web » (bureau, visiteur public) ─────────
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
                <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, appNameFontStyle]}>{L.brandName}</Text>
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
            <Text {...APP_NAME_TEXT_PROPS} style={[styles.footerBrand, appNameFontStyle]}>{L.brandName}</Text>
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

    // Mode « intégré à l'app » (bureau, connecté) — calqué sur app/(tabs)/_layout.
    appDesktopShell: { flex: 1, flexDirection: 'row', backgroundColor: c.bg },
    appDesktopMain: { flex: 1, minWidth: 0, height: '100%' },
    appDesktopScroll: { flexGrow: 1, paddingHorizontal: 32, paddingTop: 16, paddingBottom: 24 },
    appDesktopColumn: { width: '100%', maxWidth: MAX_W.settings, alignSelf: 'center' },

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
