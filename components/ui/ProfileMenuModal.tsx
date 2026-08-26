import { useMemo } from 'react';
/**
 * ProfileMenuModal — menu en surimpression ouvert depuis l'avatar de l'en-tête.
 * Regroupe l'accès aux pages « compte » (profil, financier, reporting, boutique, plan,
 * paramètres, apparence, support) + déconnexion + pied de page. Affiche le tag Premium.
 */
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Modal, Image, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { usePlan } from '../../hooks/config/usePlan';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useUserUnreadCount } from '../../hooks/admin/useUnreadBadges';
import { useCosmetics } from '../../hooks/theme/useCosmetics';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/theme/useBrandFont';
import { APP_VERSION, copyrightNotice } from '../../lib/platform/appVersion';

export default function ProfileMenuModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFontStyle = useAppNameFontStyle();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { isPremium, isResolved: planResolved } = usePlan(user?.id);
  /* HAUTEUR DISPONIBLE — le panneau ne doit JAMAIS dépasser la fenêtre. Il n'avait aucune limite :
     seule la liste des entrées était plafonnée (430 px), et le reste (bouton « Se déconnecter »,
     pied de page) débordait purement et simplement hors de l'écran, sans possibilité de défiler.
     Sur un petit téléphone, et sur N'IMPORTE QUEL téléphone en mode paysage (l'app n'est pas
     verrouillée en portrait), se déconnecter devenait impossible depuis ce menu. */
  const { height: winHeight } = useWindowDimensions();
  const topPad = Platform.OS === 'web' ? 56 : 70;

  // Source de vérité unique : profiles.avatar_url (cf. HeaderWithProfile). Pas de repli Google.
  const avatarUrl = profile?.avatar_url ?? undefined;
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Utilisateur';
  const isAdmin = (profile as any)?.is_admin === true;
  const supportUnread = useUserUnreadCount(user?.id);
  const { avatarFrameColor, profileTitle } = useCosmetics(user?.id);
  // Titres cosmétiques équipés, triés par ordre alphabétique (un seul emplacement pour l'instant).
  const cosmeticTitles = (profileTitle ? [profileTitle] : []).sort((a, b) => a.localeCompare(b, 'fr'));

  /* `navigate` et non `push` : une entrée de menu REVIENT sur une page, elle n'en empile pas une
     n-ième copie. Sans ça, ouvrir cinq fois « Reporting » depuis l'avatar laissait cinq écrans dans
     la pile — et autant d'appuis sur « retour » pour en sortir. Même règle que le menu du bureau
     (WebSideNav), qui l'appliquait déjà pour exactement ces destinations. */
  const go = (route: string) => { onClose(); router.navigate(route as any); };
  // signOut() se charge de tout (voile, navigation, purge) — cf. AuthContext.
  const logout = () => { onClose(); signOut(); };

  // Conseils IA : bouton TOUJOURS visible (comme une vitrine). C'est l'ACCÈS au clic qui change selon
  // les réglages admin (Premium requis, ou « Ouvrir à tous ») — géré dans la page elle-même.

  const items: { icon: string; label: string; route: string; color?: string; premium?: boolean }[] = [
    { icon: 'person-circle-outline', label: 'Mon Profil', route: '/(tabs)/(secondary)/profile' },
    { icon: 'color-palette-outline', label: 'Apparence', route: '/(tabs)/(secondary)/apparence', color: '#0ea5a8' },
    /* L'étoile signale « réservé aux abonnés » : elle n'a donc de sens que pour un NON-abonné.
       Elle était affichée en dur, si bien qu'un abonné Premium voyait un cadenas sur des pages
       qu'il paye — et le menu web (WebSideNav), lui, la masquait déjà correctement.
       `planResolved` : tant que le plan n'est pas revenu, `isPremium` vaut faux par DÉFAUT, pas par
       réponse — un abonné voyait donc l'étoile réapparaître une fraction de seconde à chaque
       ouverture du menu. On ne signale un manque qu'une fois qu'on sait qu'il en manque un. */
    { icon: 'bar-chart-outline', label: 'Reporting', route: '/(tabs)/reporting', color: '#f59e0b', premium: planResolved && !isPremium },
    { icon: 'sparkles-outline', label: 'Conseils Intelligents', route: '/(tabs)/conseils-ia', color: '#10b981', premium: planResolved && !isPremium },
    /* « Succès » manquait ici. Sur mobile, la page n'était atteignable QUE par la pastille de série
       de l'en-tête — laquelle disparaît tant que l'état de gamification n'est pas chargé (ou s'il
       échoue) : la page devenait alors purement et simplement inaccessible. Elle est à sa place à
       côté de la Boutique, qu'elle alimente. */
    { icon: 'ribbon-outline', label: 'Succès', route: '/(tabs)/(secondary)/succes', color: '#f59e0b' },
    { icon: 'bag-handle-outline', label: 'Boutique', route: '/(tabs)/(secondary)/boutique', color: '#22d3ee' },
    { icon: 'star-outline', label: 'Plan', route: '/(tabs)/(secondary)/premium', color: '#fbbf24' },
    { icon: 'options-outline', label: 'Paramètres', route: '/(tabs)/(secondary)/parametres' },
    { icon: 'headset-outline', label: 'Support', route: '/(tabs)/(secondary)/support', color: COLORS.green },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="Fermer le menu">
        <TouchableOpacity testID="profile-menu-panel" activeOpacity={1} style={[styles.panel, { maxHeight: Math.max(220, winHeight - topPad - 16) }]} onPress={() => {}}>
          {/* En-tête : avatar + nom + tag premium */}
          <View style={styles.header}>
            <View style={avatarFrameColor ? [styles.avatarFrame, { borderColor: avatarFrameColor }] : undefined}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}><Ionicons name="person" size={22} color={COLORS.textSecondary} /></View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              {/* Étiquettes côte à côte (retour à la ligne si besoin) — ordre : Admin, Premium, titres cosmétiques. */}
              <View style={styles.tagsRow}>
                {isAdmin && (
                  <View style={[styles.tag, { backgroundColor: COLORS.green + '22', borderColor: COLORS.green }]}>
                    <Ionicons name="shield-checkmark" size={10} color={COLORS.green} />
                    <Text style={[styles.tagText, { color: COLORS.green }]}>Admin</Text>
                  </View>
                )}
                {isPremium && (
                  <View style={[styles.tag, { backgroundColor: COLORS.yellow + '22', borderColor: COLORS.yellow }]}>
                    <Ionicons name="star" size={10} color={COLORS.yellow} />
                    <Text style={[styles.tagText, { color: COLORS.yellow }]}>Premium</Text>
                  </View>
                )}
                {cosmeticTitles.map((t) => (
                  <View key={t} style={[styles.tag, { backgroundColor: '#f59e0b1A', borderColor: '#f59e0b66' }]}>
                    <Ionicons name="ribbon" size={10} color="#f59e0b" />
                    <Text style={[styles.tagText, { color: '#f59e0b' }]}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* `flexShrink: 1` : c'est CETTE liste qui cède la place quand la fenêtre est basse (elle
              défile), pour que la déconnexion et le pied de page restent toujours visibles. */}
          <ScrollView style={{ maxHeight: 430, flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            {items.map((item) => {
              const badgeCount = item.label === 'Support' ? supportUnread : 0;
              return (
                <Pressable
                  key={item.label}
                  style={({ hovered }: any) => [styles.row, hovered && styles.rowHover]}
                  onPress={() => go(item.route)}
                  accessibilityRole="button"
                  accessibilityLabel={badgeCount > 0 ? `${item.label}, ${badgeCount} non lu${badgeCount > 1 ? 's' : ''}` : item.label}
                >
                  <Ionicons name={item.icon as any} size={20} color={item.color ?? COLORS.emerald} />
                  <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                  {item.premium && (
                    <View testID="premium-star" style={styles.premiumStar}>
                      <Ionicons name="star" size={10} color="#F5B301" />
                    </View>
                  )}
                  {badgeCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
            <Text style={styles.logoutLabel}>Se déconnecter</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text {...APP_NAME_TEXT_PROPS} style={[styles.footerBrand, appNameFontStyle]}>Relyka</Text>
            <Text style={styles.footerTag}>Laisse-toi guider pour faire des économies.</Text>
            <Text style={styles.footerVersion}>Version {APP_VERSION} · {copyrightNotice()}</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'flex-end', paddingTop: Platform.OS === 'web' ? 56 : 70, paddingRight: 10, paddingLeft: 10 },
    panel: {
      width: '100%', maxWidth: 340, backgroundColor: c.cardSolid ?? c.card,
      borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 14,
      shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 24, elevation: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.cardBorder, marginBottom: 6 },
    avatar: { width: 44, height: 44, borderRadius: 22 },
    avatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    avatarFrame: { borderWidth: 2.5, borderRadius: 26, padding: 2 },
    name: { fontSize: 16, fontWeight: '800', color: c.text },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    tagText: { fontSize: 10, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    rowHover: { backgroundColor: c.text + '14' },
    unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    unreadBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: c.text },
    premiumStar: { marginLeft: 6, width: 18, height: 18, borderRadius: 5, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' },
    divider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 8 },
    logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 13 },
    logoutLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    footer: { alignItems: 'center', marginTop: 14, gap: 3 },
    footerBrand: { fontSize: 16, fontWeight: '800', color: c.text },
    footerTag: { fontSize: 11, color: c.emerald, fontWeight: '500' },
    footerVersion: { fontSize: 10, color: c.textSecondary, marginTop: 2 },
  });
}
