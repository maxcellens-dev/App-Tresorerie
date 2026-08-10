/**
 * WebSideNav — barre latérale de navigation, WEB BUREAU uniquement (largeur >= 1024 px).
 *
 * Elle remplace la barre d'onglets du bas (CustomTabBar) et le bouton flottant « + », qui sont des
 * conventions TACTILES : sur un écran d'ordinateur, la navigation vit à gauche, en permanence
 * visible, et l'action principale est un bouton explicite en haut de cette colonne.
 *
 * Rien de ceci n'est monté sur natif ni sur navigateur étroit : `app/(tabs)/_layout` ne rend ce
 * composant que si `useResponsive().isDesktop` est vrai.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useAppColors } from '../../hooks/useAppColors';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/useProfile';
import { usePlan } from '../../hooks/usePlan';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/useBrandFont';
import { useRwInvitations } from '../../hooks/useRelykaWorld';
import { useAccountInvitations, useSharedAccountsRealtime } from '../../hooks/useSharedAccounts';
import { useCreditInvitations, useSharedCreditsRealtime } from '../../hooks/useSharedCredits';
import { useAdminUnreadCount, useUserUnreadCount } from '../../hooks/useUnreadBadges';
import { SIDEBAR_WIDTH, pointer, transition, shadow } from '../../lib/webLayout';
import { APP_VERSION } from '../../lib/appVersion';
import { UnreadBadge } from '../HeaderWithProfile';

interface NavItem {
  key: string;
  label: string;
  icon: string;
  route: string;
  /** Segments qui rendent l'entrée active (en plus de `key`). */
  aliases?: string[];
  badge?: number;
  premium?: boolean;
}

/** Actions de saisie du bouton principal — mêmes routes que le « + » mobile (QuickAddButton). */
const QUICK_ACTIONS = [
  { key: 'expense', label: 'Dépense', icon: 'arrow-down', tone: 'danger', route: '/(tabs)/transactions/add?type=expense' },
  { key: 'income', label: 'Recette', icon: 'arrow-up', tone: 'green', route: '/(tabs)/transactions/add?type=income' },
  { key: 'transfer', label: 'Virement', icon: 'swap-horizontal', tone: 'blue', route: '/(tabs)/transactions/add?type=transfer' },
  { key: 'balance', label: 'Mettre à jour un solde', icon: 'refresh', tone: 'emerald', route: '/(tabs)/comptes/solde' },
] as const;

export default function WebSideNav() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const segments = useSegments() as string[];
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { isPremium } = usePlan(user?.id);
  const { data: flags } = useFeatureFlags();
  const appNameFontStyle = useAppNameFontStyle();
  const [quickOpen, setQuickOpen] = useState(false);

  const isAdmin = (profile as any)?.is_admin === true;
  const adminUnread = useAdminUnreadCount(isAdmin, user?.id);
  // Réponses de l'assistance non lues — même compteur que la pastille de l'avatar.
  const supportUnread = useUserUnreadCount(user?.id);

  // Mêmes pastilles que la barre d'onglets mobile : invitations en attente.
  const { data: rwInvitations = [] } = useRwInvitations(user?.id);
  const { data: acctInvitations = [] } = useAccountInvitations(user?.id);
  const { data: creditInvitations = [] } = useCreditInvitations(user?.id);
  useSharedAccountsRealtime(user?.id);
  useSharedCreditsRealtime(user?.id);
  const acctInviteCount = acctInvitations.length + creditInvitations.length;

  const main: NavItem[] = [
    { key: 'pilotage', label: 'Tableau de bord', icon: 'grid-outline', route: '/(tabs)/pilotage' },
    { key: 'transactions', label: 'Transactions', icon: 'swap-vertical-outline', route: '/(tabs)/transactions' },
    { key: 'comptes', label: 'Comptes', icon: 'wallet-outline', route: '/(tabs)/comptes', badge: acctInviteCount },
    { key: 'projects', label: 'Projets', icon: 'flag-outline', route: '/(tabs)/projects', badge: rwInvitations.length },
    { key: 'projection', label: 'Projection', icon: 'trending-up-outline', route: '/(tabs)/projection' },
  ];

  const analyse: NavItem[] = [
    { key: 'tresorerie', label: 'Plan de trésorerie', icon: 'calendar-outline', route: '/(tabs)/tresorerie' },
    { key: 'reporting', label: 'Reporting', icon: 'bar-chart-outline', route: '/(tabs)/reporting', premium: !isPremium },
    { key: 'conseils-ia', label: 'Conseils Intelligents', icon: 'sparkles-outline', route: '/(tabs)/conseils-ia', premium: !isPremium },
  ];

  // « Mon espace » — les pages du menu de l'avatar, en raccourci permanent. Sur un écran
  // d'ordinateur, il n'y a aucune raison de cacher quatre pages derrière un clic sur la photo de
  // profil : la place est là.
  const espace: NavItem[] = [
    { key: 'apparence', label: 'Apparence', icon: 'color-palette-outline', route: '/(tabs)/(secondary)/apparence' },
    { key: 'succes', label: 'Succès', icon: 'ribbon-outline', route: '/(tabs)/(secondary)/succes' },
    { key: 'boutique', label: 'Boutique', icon: 'bag-handle-outline', route: '/(tabs)/(secondary)/boutique' },
    { key: 'premium', label: 'Plan', icon: 'star-outline', route: '/(tabs)/(secondary)/premium' },
  ];

  // Bas de colonne : ce qu'on cherche quand on ne cherche pas un chiffre. Le Support y a sa place
  // à côté des Paramètres — il n'était atteignable que par le menu de l'avatar, donc invisible.
  const bottom: NavItem[] = [
    { key: 'parametres', label: 'Paramètres', icon: 'options-outline', route: '/(tabs)/(secondary)/parametres', aliases: ['categories', 'profile', 'mes-donnees'] },
    { key: 'support', label: 'Support', icon: 'headset-outline', route: '/(tabs)/(secondary)/support', badge: supportUnread, aliases: ['assistance', 'ideas'] },
    ...(isAdmin ? [{ key: 'admin', label: 'Admin', icon: 'shield-checkmark-outline', route: '/(tabs)/(secondary)/admin', badge: adminUnread } as NavItem] : []),
  ];

  /**
   * Chemin logique de la route courante, groupes Expo Router retirés :
   * `(tabs)/(secondary)/admin/assistance` → `/admin/assistance`.
   * On le reconstruit depuis les segments plutôt que de faire confiance à `usePathname` : c'est la
   * même information, mais sans dépendre de la façon dont il traite les groupes.
   */
  const segPath = '/' + segments.filter((s) => !s.startsWith('(')).join('/');

  /**
   * Une entrée est active si la route courante EST sa route ou vit dessous. Le préfixe est comparé
   * segment par segment (`/support` ou `/support/…`, jamais `/supportXYZ`) — et surtout, `/assistance`
   * n'active pas `/admin/assistance`, ce qu'un simple « le segment apparaît quelque part » faisait.
   */
  const isActive = (it: NavItem) => {
    const keys = [it.key, ...(it.aliases ?? [])];
    return keys.some((k) => segPath === `/${k}` || segPath.startsWith(`/${k}/`));
  };

  /**
   * `navigate` (et non `push`) pour les entrées de menu : on REVIENT sur un onglet déjà monté au
   * lieu d'empiler une n-ième copie — sinon le bouton « précédent » du navigateur remonte tout
   * l'historique des clics de barre latérale. `push` reste utilisé pour les écrans de SAISIE, qu'on
   * veut bien pouvoir quitter avec « retour ».
   */
  const go = (route: string, mode: 'navigate' | 'push' = 'navigate') => {
    setQuickOpen(false);
    if (mode === 'push') router.push(route as any);
    else router.navigate(route as any);
  };

  const renderItem = (it: NavItem) => {
    const active = isActive(it);
    return (
      <Pressable
        key={it.key}
        onPress={() => go(it.route)}
        accessibilityRole="link"
        style={({ hovered }: any) => [styles.item, hovered && !active && styles.itemHover, active && styles.itemActive]}
      >
        {active && <View style={styles.activeBar} />}
        <Ionicons name={it.icon as any} size={19} color={active ? COLORS.emerald : COLORS.textSecondary} />
        <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
          {it.label}
        </Text>
        {it.premium && (
          <View style={styles.premiumDot}>
            <Ionicons name="star" size={9} color="#F5B301" />
          </View>
        )}
        {!!it.badge && it.badge > 0 && (
          <View style={styles.badgeSlot}>
            <UnreadBadge count={it.badge} style={{ top: -8, right: -6 }} />
          </View>
        )}
      </Pressable>
    );
  };

  const tone = (t: string) =>
    t === 'danger' ? COLORS.danger : t === 'green' ? COLORS.green : t === 'blue' ? COLORS.blue : COLORS.emerald;

  return (
    <View style={styles.sidebar}>
      {/* Voile invisible plein écran : un clic n'importe où referme le menu de saisie rapide
          (comportement attendu d'un menu déroulant sur ordinateur). */}
      {quickOpen && <Pressable style={styles.quickBackdrop} onPress={() => setQuickOpen(false)} accessibilityLabel="Fermer le menu" />}

      {/* ── Marque ── */}
      <Pressable onPress={() => go('/(tabs)/pilotage')} style={({ hovered }: any) => [styles.brandRow, hovered && { opacity: 0.85 }]}>
        <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
        <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, appNameFontStyle]} numberOfLines={1}>Relyka</Text>
      </Pressable>

      {/* ── Action principale (remplace le « + » flottant) ── */}
      <View style={styles.quickWrap}>
        <View>
          <Pressable
            onPress={() => setQuickOpen((v) => !v)}
            accessibilityRole="button"
            style={({ hovered }: any) => [styles.quickBtn, hovered && styles.quickBtnHover]}
          >
            <Ionicons name={quickOpen ? 'close' : 'add'} size={18} color={COLORS.bg} />
            <Text style={styles.quickBtnText}>Nouvelle opération</Text>
          </Pressable>
        </View>
        {quickOpen && (
          <View style={styles.quickMenu}>
            {QUICK_ACTIONS.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => go(a.route, 'push')}
                style={({ hovered }: any) => [styles.quickItem, hovered && styles.itemHover]}
              >
                <View style={[styles.quickIcon, { backgroundColor: tone(a.tone) + '1F' }]}>
                  <Ionicons name={a.icon as any} size={15} color={tone(a.tone)} />
                </View>
                <Text style={styles.quickItemLabel} numberOfLines={1}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ── Navigation ── */}
      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Pilotage</Text>
        {main.map(renderItem)}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Analyse</Text>
        {analyse.map(renderItem)}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Mon espace</Text>
        {espace.map(renderItem)}
      </ScrollView>

      {/* ── Bas de colonne ── */}
      <View style={styles.footer}>
        {bottom.map(renderItem)}
        <Text style={styles.version}>Version {APP_VERSION}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sidebar: {
      width: SIDEBAR_WIDTH,
      flexShrink: 0,
      height: '100%',
      backgroundColor: c.cardSolid,
      borderRightWidth: 1,
      borderRightColor: c.cardBorder,
      paddingTop: 18,
      zIndex: 20,
    },

    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, marginBottom: 18, ...(pointer as any), ...(transition as any) },
    brandLogo: { width: 30, height: 30, borderRadius: 8 },
    brand: { fontSize: 21, fontWeight: '800', color: c.text, letterSpacing: -0.4 },

    quickBackdrop: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 25 },
    quickWrap: { paddingHorizontal: 14, marginBottom: 16, zIndex: 30 },
    quickBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
      ...(pointer as any), ...(transition as any),
    },
    quickBtnHover: { ...(shadow(2) as any), opacity: 0.94 },
    quickBtnText: { color: c.bg, fontSize: 14, fontWeight: '700' },
    quickMenu: {
      position: 'absolute', top: 48, left: 14, right: 14,
      backgroundColor: c.cardSolid, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      paddingVertical: 6, ...(shadow(3) as any),
    },
    quickItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, marginHorizontal: 4, ...(pointer as any), ...(transition as any) },
    quickIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    quickItemLabel: { color: c.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },

    nav: { flex: 1 },
    navContent: { paddingHorizontal: 10, paddingBottom: 16 },
    sectionLabel: {
      fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase',
      color: c.textSecondary, opacity: 0.75, paddingHorizontal: 10, marginBottom: 6,
    },

    item: {
      flexDirection: 'row', alignItems: 'center', gap: 11,
      paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9, marginBottom: 2,
      ...(pointer as any), ...(transition as any),
    },
    itemHover: { backgroundColor: c.card },
    itemActive: { backgroundColor: c.emerald + '18' },
    activeBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: c.emerald },
    itemLabel: { fontSize: 13.5, fontWeight: '600', color: c.textSecondary, flexShrink: 1 },
    itemLabelActive: { color: c.text, fontWeight: '700' },
    premiumDot: { width: 16, height: 16, borderRadius: 5, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' },
    badgeSlot: { width: 18, height: 18, marginLeft: 'auto' },

    footer: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12 },
    version: { fontSize: 10.5, color: c.textSecondary, opacity: 0.6, paddingHorizontal: 10, marginTop: 6 },
  });
}
