/**
 * Voile de COUPURE GLOBALE. Quand l'admin active le kill switch (Centre de sécurité), tous les
 * utilisateurs voient ce voile plein écran et ne peuvent plus interagir avec l'app. Les ADMINS ne
 * sont PAS bloqués (ils gardent l'accès pour rouvrir), mais voient un bandeau d'alerte discret.
 *
 * Monté au niveau racine, au-dessus de tout. Bascule instantanée via le realtime de useAppLockdown.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAppLockdown } from '../../hooks/platform/useSecurity';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';

export default function SecurityGate() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const { locked, title, message } = useAppLockdown();

  if (!locked) return null;

  // ── Admin : pas de blocage, juste un rappel + accès direct au Centre de sécurité pour rouvrir. ──
  if (isAdmin) {
    return (
      <Pressable
        style={[styles.adminBanner, { bottom: 72 + insets.bottom }]}
        onPress={() => router.push('/(tabs)/(secondary)/admin/security' as any)}
        accessibilityRole="button"
      >
        <Ionicons name="lock-closed" size={16} color="#fff" />
        <Text style={styles.adminTxt}>Coupure globale ACTIVE — l’app est verrouillée pour les utilisateurs. Toucher pour gérer.</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark" size={34} color={COLORS.emerald} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <ActivityIndicator color={COLORS.textSecondary} style={{ marginTop: 18 }} />
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
      zIndex: 100000,
      elevation: 100000,
    },
    card: { alignItems: 'center', maxWidth: 420 },
    iconWrap: {
      width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 22,
    },
    title: { fontSize: 22, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 12 },
    message: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
    // Bandeau AU-DESSUS de la barre d'onglets (jamais par-dessus l'en-tête ni le menu du bas) → l'admin
    // garde l'accès au menu profil (déconnexion) ET aux onglets. `bottom` réglé au runtime (72 + inset).
    adminBanner: {
      position: 'absolute', left: 0, right: 0, zIndex: 100000, elevation: 100000,
      backgroundColor: c.danger, paddingVertical: 10, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    adminTxt: { color: '#fff', fontSize: 12.5, fontWeight: '700', flex: 1 },
  });
}
