/**
 * LegalLayout — habillage commun des pages publiques (Confidentialité, Mentions légales).
 *
 * TROIS présentations, choisies par `legalPresentation()` — selon la largeur ET la connexion :
 *  • `site` — visiteur PUBLIC sur écran large (≥ 900 px) → en-tête + pied de page « site web »,
 *    dessinés comme la vitrine (logo, « Se connecter », « Commencer »).
 *  • `appDesktop` — utilisateur CONNECTÉ sur écran bureau (≥ 1024 px) → la page est INTÉGRÉE à
 *    l'app : barre latérale de navigation à gauche, barre supérieure avec le profil, contenu dans
 *    une colonne de lecture. Une fois connecté, on ne ressort plus « sur le site ».
 *  • `app` — mobile, tablette et natif → CONNECTÉ : en-tête d'app identique aux autres pages ;
 *    VISITEUR : un en-tête simple (logo, « Se connecter ») — jamais la barre de l'app connectée
 *    (série, aide), qui n'a aucun sens avant connexion.
 * Couleurs et polices du Jardin (usePublicColors → palette du Jardin dans le mode de la vitrine).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, useWindowDimensions } from 'react-native';
import ScreenGradient from '../layout/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { usePublicColors } from '../../hooks/theme/usePublicColors';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import { useLandingConfig, DEFAULT_LANDING } from '../../hooks/config/useLandingConfig';
import { useNavBack } from '../../hooks/platform/useNavBack';
import { DESKTOP_MIN_WIDTH } from '../../hooks/theme/useResponsive';
import { MAX_W } from '../../lib/ui/webLayout';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import GardenTopBar from '../garden/GardenTopBar';
import GardenSideNav from '../garden/GardenSideNav';

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

  const backRow = (
    <TouchableOpacity style={styles.backRow} onPress={goBack} activeOpacity={0.7} accessibilityRole="button">
      <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
      <Text style={styles.backText}>Retour</Text>
    </TouchableOpacity>
  );

  // Pied de page — IDENTIQUE à la vitrine (config admin).
  const footer = (
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
  );

  // ───────── Mode « intégré à l'app » (bureau, connecté) ─────────
  if (presentation === 'appDesktop') {
    return (
      <View style={styles.appDesktopShell}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <GardenSideNav />
        <View style={styles.appDesktopMain}>
          {/* En PREMIER : le dégradé est en absoluteFill, il doit passer DERRIÈRE l'en-tête. */}
          <ScreenGradient />
          <GardenTopBar title={title} applyTopInset={false} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.appDesktopScroll}>
            <View style={styles.appDesktopColumn}>
              {backRow}
              {children}
              <View style={{ height: 48 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    );
  }

  // ───────── Mode « site web » (bureau, visiteur public) ─────────
  if (presentation === 'site') {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={styles.siteHeader}>
            <View style={styles.siteHeaderInner}>
              <TouchableOpacity style={styles.brandRow} onPress={() => router.replace('/welcome')} activeOpacity={0.8} accessibilityRole="link">
                <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
                <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, appNameFontStyle]}>{L.brandName}</Text>
              </TouchableOpacity>
              <View style={styles.siteHeaderBtns}>
                <TouchableOpacity style={styles.siteGhost} onPress={() => router.push('/login')} activeOpacity={0.85} accessibilityRole="link">
                  <Text style={styles.siteGhostText}>Se connecter</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.siteCta} onPress={() => router.push('/register')} activeOpacity={0.85} accessibilityRole="link">
                  <Text style={styles.siteCtaText}>Commencer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.siteBody}>
            <View style={styles.contentWrap}>
              {backRow}
              <Text style={styles.pageTitle}>{title}</Text>
              {children}
            </View>
          </View>
          {footer}
        </ScrollView>
      </View>
    );
  }

  // ───────── Mode « app » (mobile / natif) ─────────
  if (!user) {
    // Visiteur : en-tête simple, défilement de toute la page, pied de page de la vitrine.
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <View style={styles.visitorHeader}>
            <TouchableOpacity style={styles.brandRow} onPress={() => router.replace('/welcome')} activeOpacity={0.8} accessibilityRole="link">
              <Image source={require('../../assets/logo.png')} style={styles.brandLogoSmall} resizeMode="contain" />
              <Text {...APP_NAME_TEXT_PROPS} style={[styles.brandSmall, appNameFontStyle]}>{L.brandName}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.siteGhost} onPress={() => router.push('/login')} activeOpacity={0.85} accessibilityRole="link">
              <Text style={styles.siteGhostText}>Se connecter</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={styles.appSafe}>
              {backRow}
              <Text style={styles.appTitle}>{title}</Text>
              {children}
            </View>
            {footer}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // Connecté : en-tête identique aux autres pages.
  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <GardenTopBar title={title} />
      <SafeAreaView style={styles.appSafe} edges={['left', 'right', 'bottom']}>
        {backRow}
        <Text style={styles.appTitle}>{title}</Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {children}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const web = (v: Record<string, unknown>) => (Platform.OS === 'web' ? (v as any) : {});

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    contentWrap: { width: '100%', maxWidth: MAX_W.reading, alignSelf: 'center' },

    // Mode « intégré à l'app » (bureau, connecté) — calqué sur app/(tabs)/_layout.
    appDesktopShell: { flex: 1, flexDirection: 'row', backgroundColor: c.bg },
    appDesktopMain: { flex: 1, minWidth: 0, height: '100%' },
    appDesktopScroll: { flexGrow: 1, paddingHorizontal: 32, paddingTop: 16, paddingBottom: 24 },
    /* Largeur de LECTURE (pages de prose : une ligne de 1 180 px cesse d'être lisible). */
    appDesktopColumn: { width: '100%', maxWidth: MAX_W.reading, alignSelf: 'center' },

    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, alignSelf: 'flex-start', ...web({ cursor: 'pointer' }) },
    backText: { fontFamily: GF.bodyBold, fontWeight: 'normal', fontSize: 15, color: c.textSecondary },
    pageTitle: { fontFamily: GF.display, fontWeight: 'normal', fontSize: 32, lineHeight: 38, color: c.text, marginBottom: 14 },

    // En-tête site (même dessin que la vitrine)
    siteHeader: { borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.bg },
    siteHeaderInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, maxWidth: MAX_W.dashboard, width: '100%', alignSelf: 'center', gap: 12 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, ...web({ cursor: 'pointer' }) },
    brandLogo: { width: 36, height: 36 },
    brandLogoSmall: { width: 30, height: 30 },
    brand: { fontSize: 22, color: c.text },
    brandSmall: { fontSize: 19, color: c.text },
    siteHeaderBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    siteGhost: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, ...web({ cursor: 'pointer' }) },
    siteGhostText: { fontFamily: GF.bodyBold, fontWeight: 'normal', fontSize: 15, color: c.emerald },
    siteCta: { minHeight: 42, justifyContent: 'center', backgroundColor: c.emerald, paddingHorizontal: 18, borderRadius: 999, ...web({ cursor: 'pointer' }) },
    siteCtaText: { fontFamily: GF.bodyBold, fontWeight: 'normal', fontSize: 15, color: c.onAccent },

    siteBody: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },

    // Pied de page (config admin, comme la vitrine)
    siteFooter: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center', gap: 8 },
    footerBrand: { fontSize: 20, color: c.text },
    footerText: { fontFamily: GF.body, fontWeight: 'normal', fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 6, justifyContent: 'center' },
    footerLink: { fontFamily: GF.bodyBold, fontWeight: 'normal', fontSize: 14, color: c.emerald, ...web({ cursor: 'pointer' }) },
    footerCopy: { fontFamily: GF.body, fontWeight: 'normal', fontSize: 12, color: c.textSecondary, marginTop: 10 },

    // Mode « app » (mobile / natif)
    visitorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    appSafe: { flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
    appTitle: { fontFamily: GF.display, fontWeight: 'normal', fontSize: 27, lineHeight: 33, color: c.text, marginBottom: 14 },
  });
}
