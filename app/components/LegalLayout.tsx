/**
 * LegalLayout — habillage commun des pages publiques (Confidentialité, Mentions légales).
 *
 * Deux présentations, selon la LARGEUR (bureau vs mobile), pas la plateforme :
 *  • Bureau (web large ≥ 900 px) → en-tête + pied de page « site web » (logo, Connexion/
 *    Inscription) : ces pages sont aussi accessibles publiquement depuis la page d'accueil.
 *  • Mobile / app (largeur < 900 px ou natif) → en-tête D'APP identique aux autres pages
 *    (barre « Relyka » + série/gemmes/avatar, puis flèche « Retour » + titre).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, useWindowDimensions } from 'react-native';
import ScreenGradient from './ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useAppNameFont } from '../hooks/useBrandFont';
import { useNavBack } from '../hooks/useNavBack';
import HeaderWithProfile from './HeaderWithProfile';

/** Seuil « bureau » : au-delà, on affiche l'habillage site web ; en-dessous, l'app. */
export const LEGAL_DESKTOP_MIN_WIDTH = 900;

export default function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= LEGAL_DESKTOP_MIN_WIDTH;
  const goBack = useNavBack();

  // ───────── Mode « site web » (bureau) ─────────
  if (isDesktopWeb) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          {/* En-tête site */}
          <View style={styles.siteHeader}>
            <View style={styles.siteHeaderInner}>
              <TouchableOpacity style={styles.brandRow} onPress={() => router.replace(user ? '/(tabs)/pilotage' : '/welcome')} activeOpacity={0.8}>
                <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
                <Text style={[styles.brand, { fontFamily: appNameFont }]}>Relyka</Text>
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

          {/* Pied de page site */}
          <View style={styles.siteFooter}>
            <Text style={[styles.footerBrand, { fontFamily: appNameFont }]}>Relyka</Text>
            <Text style={styles.footerText}>Laissez-vous guider pour faire des économies.</Text>
            <View style={styles.footerLinks}>
              <TouchableOpacity onPress={() => router.push('/confidentialite')}><Text style={styles.footerLink}>Confidentialité</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/legal')}><Text style={styles.footerLink}>Mentions légales</Text></TouchableOpacity>
            </View>
            <Text style={styles.footerCopy}>© {new Date().getFullYear()} Relyka. Tous droits réservés.</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ───────── Mode « app » (mobile / natif) : en-tête identique aux autres pages ─────────
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
