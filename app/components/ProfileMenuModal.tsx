/**
 * ProfileMenuModal — menu en surimpression ouvert depuis l'avatar de l'en-tête.
 * Regroupe l'accès aux pages « compte » (profil, financier, reporting, boutique, plan,
 * paramètres, apparence, support) + déconnexion + pied de page. Affiche le tag Premium.
 */
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Modal, Image, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { usePlan } from '../hooks/usePlan';
import { useAppColors } from '../hooks/useAppColors';
import { useAppNameFont } from '../hooks/useBrandFont';

const APP_VERSION = '1.0.0';

export default function ProfileMenuModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { isPremium } = usePlan(user?.id);

  const avatarUrl = profile?.avatar_url ?? user?.user_metadata?.avatar_url;
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Utilisateur';
  const isAdmin = (profile as any)?.is_admin === true;

  const go = (route: string) => { onClose(); router.push(route as any); };
  const logout = async () => { onClose(); await signOut(); router.replace('/welcome'); };

  const items: { icon: string; label: string; route: string; color?: string }[] = [
    { icon: 'person-circle-outline', label: 'Mon Profil', route: '/(tabs)/(secondary)/profile' },
    { icon: 'color-palette-outline', label: 'Apparence', route: '/(tabs)/(secondary)/apparence', color: '#0ea5a8' },
    { icon: 'bar-chart-outline', label: 'Reporting', route: '/(tabs)/reporting', color: '#f59e0b' },
    { icon: 'bag-handle-outline', label: 'Boutique', route: '/(tabs)/(secondary)/boutique', color: '#22d3ee' },
    { icon: 'star-outline', label: 'Plan', route: '/(tabs)/(secondary)/premium', color: '#fbbf24' },
    { icon: 'options-outline', label: 'Paramètres', route: '/(tabs)/(secondary)/parametres' },
    { icon: 'headset-outline', label: 'Support', route: '/(tabs)/(secondary)/support', color: '#34d399' },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.panel} onPress={() => {}}>
          {/* En-tête : avatar + nom + tag premium */}
          <View style={styles.header}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}><Ionicons name="person" size={22} color={COLORS.textSecondary} /></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <View style={styles.tagsRow}>
                {isPremium && (
                  <View style={[styles.tag, { backgroundColor: COLORS.yellow + '22', borderColor: COLORS.yellow }]}>
                    <Ionicons name="star" size={10} color={COLORS.yellow} />
                    <Text style={[styles.tagText, { color: COLORS.yellow }]}>Premium</Text>
                  </View>
                )}
                {isAdmin && (
                  <View style={[styles.tag, { backgroundColor: '#34d39922', borderColor: '#34d399' }]}>
                    <Ionicons name="shield-checkmark" size={10} color="#34d399" />
                    <Text style={[styles.tagText, { color: '#34d399' }]}>Admin</Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {items.map((it) => (
              <Pressable key={it.label} style={({ hovered }: any) => [styles.row, hovered && styles.rowHover]} onPress={() => go(it.route)}>
                <Ionicons name={it.icon as any} size={20} color={it.color ?? COLORS.emerald} />
                <Text style={styles.rowLabel}>{it.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
            <Text style={styles.logoutLabel}>Se déconnecter</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={[styles.footerBrand, { fontFamily: appNameFont }]}>Relyka</Text>
            <Text style={styles.footerTag}>Laissez-vous guider pour faire des économies.</Text>
            <Text style={styles.footerVersion}>Version {APP_VERSION} · © 2026 Relyka</Text>
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
    name: { fontSize: 16, fontWeight: '800', color: c.text },
    tagsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    tagText: { fontSize: 10, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    rowHover: { backgroundColor: c.text + '14' },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: c.text },
    divider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 8 },
    logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 13 },
    logoutLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    footer: { alignItems: 'center', marginTop: 14, gap: 3 },
    footerBrand: { fontSize: 16, fontWeight: '800', color: c.text },
    footerTag: { fontSize: 11, color: c.emerald, fontWeight: '500' },
    footerVersion: { fontSize: 10, color: c.textSecondary, marginTop: 2 },
  });
}
