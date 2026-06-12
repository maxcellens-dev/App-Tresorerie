import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useAppColors } from '../hooks/useAppColors';
import { useUserUnreadCount, useAdminUnreadCount } from '../hooks/useUnreadBadges';
import { useCosmetics } from '../hooks/useCosmetics';
import OnboardingChecklist from './OnboardingChecklist';
import StreakChip from './StreakChip';
import ProfileMenuModal from './ProfileMenuModal';

/** Pastille rouge avec compteur (badge « non lu »). */
export function UnreadBadge({ count, style }: { count: number; style?: any }) {
  if (count <= 0) return null;
  return (
    <View style={[badgeStyles.badge, style]} pointerEvents="none">
      <Text style={badgeStyles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    zIndex: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});


interface HeaderWithProfileProps {
  title?: string;
  /** Contenu personnalisé à gauche (ex. salutation sur l'accueil). Prioritaire sur title. */
  leftContent?: React.ReactNode;
  /** Hauteur de la barre (pour décaler le contenu en dessous). Par défaut 56. */
  height?: number;
  /** Afficher le bouton retour (si pas sur une page racine) */
  showBack?: boolean;
  /** Handler personnalisé du bouton retour (sinon router.back()). */
  onBack?: () => void;
  /** Masquer l'avatar/profil à droite */
  hideProfile?: boolean;
}

/** Blende une couleur d'accent (#RRGGBB) à 30 % sur le fond — couleur opaque, aucun problème d'alpha sur web. */
function blendAccent(bg: string, accent: string, opacity = 0.30): string {
  try {
    const parse = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [r1, g1, b1] = parse(bg.length >= 7 ? bg.slice(0, 7) : '#000000');
    const [r2, g2, b2] = parse(accent.length >= 7 ? accent.slice(0, 7) : '#000000');
    const r = Math.round(r1 * (1 - opacity) + r2 * opacity);
    const g = Math.round(g1 * (1 - opacity) + g2 * opacity);
    const b = Math.round(b1 * (1 - opacity) + b2 * opacity);
    return `rgb(${r},${g},${b})`;
  } catch { return bg; }
}

export default function HeaderWithProfile({ title, leftContent, height = 56, showBack = false, onBack, hideProfile = false }: HeaderWithProfileProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const segments = useSegments();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const avatarUrl = profile?.avatar_url ?? user?.user_metadata?.avatar_url;
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Utilisateur';

  // Déterminer la page actuelle pour masquer les boutons
  const currentPage = segments[segments.length - 1] ?? '';
  const isOnSettings = currentPage === 'parametres';
  const isAdmin = (profile as any)?.is_admin === true;
  const [menuOpen, setMenuOpen] = useState(false);

  // Badges « non lu » : réponses assistance pour l'utilisateur, assistance + idées pour l'admin.
  const userUnread = useUserUnreadCount(user?.id);
  const adminUnread = useAdminUnreadCount(isAdmin);
  const { avatarFrameColor } = useCosmetics(user?.id);

  function openAdmin() {
    router.push('/(tabs)/(secondary)/admin');
  }

  // Déterminer le contenu à afficher à gauche
  const shouldShowTitle = title && title.trim() !== '';
  const leftContentToRender = leftContent || (shouldShowTitle ? (
    <Text style={styles.title} numberOfLines={1}>{title}</Text>
  ) : (
    <View style={styles.greetingWrap}>
      <Text style={styles.greeting}>Bonjour,</Text>
      <Text style={styles.greetingName} numberOfLines={1}>{displayName}</Text>
    </View>
  ));

  return (
    <View style={[styles.bar, { height }]}>
      <View style={styles.left}>
        {showBack && (
          <TouchableOpacity style={styles.backBtn} onPress={() => (onBack ? onBack() : router.back())} accessibilityRole="button">
            <Ionicons name="arrow-back" size={20} color={COLORS.text} />
            <Text style={styles.backText}>Retour</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/(tabs)/pilotage')} style={{ flexShrink: 1 }} accessibilityRole="button" accessibilityLabel="Aller au tableau de bord">
          {leftContentToRender}
        </TouchableOpacity>
      </View>
      {!hideProfile && <View style={styles.right}>
        <StreakChip />
        <OnboardingChecklist />
        {isAdmin && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={openAdmin}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Admin"
          >
            <Ionicons name="shield-checkmark" size={22} color="#34d399" />
            <UnreadBadge count={adminUnread} style={{ top: -1, right: -3 }} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={() => setMenuOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Menu du compte"
        >
          <View style={avatarFrameColor ? [styles.avatarFrame, { borderColor: avatarFrameColor }] : undefined}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} {...({ pointerEvents: 'none' } as any)} />
            ) : (
              <View style={styles.avatarPlaceholder} pointerEvents="none">
                <Ionicons name="person" size={22} color={COLORS.textSecondary} />
              </View>
            )}
          </View>
          <UnreadBadge count={userUnread} style={{ top: -2, right: -4 }} />
        </TouchableOpacity>
      </View>}
      <ProfileMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    // Couleur blendée opaque = 30 % accent sur fond → raccord gradient, compatible web
    backgroundColor: blendAccent(c.bg, c.emerald, 0.30),
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 6, marginRight: 6 },
  backText: { color: c.text, marginLeft: 4, fontSize: 14, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: c.text, letterSpacing: -0.3 },
  greetingWrap: { justifyContent: 'center' },
  greeting: { fontSize: 14, color: c.textSecondary, fontWeight: '400' },
  greetingName: { fontSize: 20, color: c.text, fontWeight: '700', marginTop: 1, letterSpacing: -0.4 },
  date: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 8 },
  avatarWrap: { padding: 4 },
  avatarFrame: { borderWidth: 2, borderRadius: 20, padding: 2 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
}
