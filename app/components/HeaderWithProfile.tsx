import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';

const COLORS = {
  bg: 'transparent',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  cardBorder: '#1e293b',
};

interface HeaderWithProfileProps {
  title?: string;
  /** Contenu personnalisé à gauche (ex. salutation sur l'accueil). Prioritaire sur title. */
  leftContent?: React.ReactNode;
  /** Hauteur de la barre (pour décaler le contenu en dessous). Par défaut 56. */
  height?: number;
  /** Afficher le bouton retour (si pas sur une page racine) */
  showBack?: boolean;
}

export default function HeaderWithProfile({ title, leftContent, height = 56, showBack = false }: HeaderWithProfileProps) {
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

  function openSettings() {
    router.push('/(tabs)/(secondary)/parametres');
  }

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
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button">
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
        )}
        {leftContentToRender}
      </View>
      <View style={styles.right}>
        {isAdmin && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={openAdmin}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Admin"
          >
            <Ionicons name="shield-checkmark" size={22} color="#34d399" />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={openSettings}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Paramètres"
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} pointerEvents="none" />
          ) : (
            <View style={styles.avatarPlaceholder} pointerEvents="none">
              <Ionicons name="person" size={22} color={COLORS.textSecondary} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    ...(Platform.OS === 'web' ? {} : {}),
    backgroundColor: 'rgba(2, 6, 23, 0.98)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 41, 59, 0.9)',
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  greetingWrap: { justifyContent: 'center' },
  greeting: { fontSize: 15, color: COLORS.textSecondary, fontWeight: '500' },
  greetingName: { fontSize: 18, color: COLORS.text, fontWeight: '800', marginTop: 1 },
  date: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 8 },
  avatarWrap: { padding: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
