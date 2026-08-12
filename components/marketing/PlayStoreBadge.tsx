/**
 * PlayStoreBadge — bouton/badge « Disponible sur Google Play » (Android).
 * Ouvre la fiche de l'app sur le Play Store. Masqué si aucune URL n'est configurée.
 * Réutilisable (page d'accueil bureau + écran d'accueil mobile web). Style « badge store » classique
 * (fond noir, texte blanc) pour rester reconnaissable quel que soit le thème de la page.
 */
import { TouchableOpacity, Text, View, StyleSheet, Linking, Platform, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function PlayStoreBadge({ url, size = 'md', style }: {
  url?: string | null;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}) {
  const clean = (url ?? '').trim();
  if (!clean) return null;

  const open = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(clean, '_blank', 'noopener');
    else Linking.openURL(clean).catch(() => {});
  };

  const iconSize = size === 'sm' ? 22 : 28;
  const bigSize = size === 'sm' ? 15 : 18;

  return (
    <TouchableOpacity
      onPress={open}
      activeOpacity={0.85}
      accessibilityRole="link"
      accessibilityLabel="Télécharger sur Google Play"
      style={[styles.badge, size === 'sm' && styles.badgeSm, style]}
    >
      <Ionicons name="logo-google-playstore" size={iconSize} color="#fff" />
      <View>
        <Text style={styles.small}>DISPONIBLE SUR</Text>
        <Text style={[styles.big, { fontSize: bigSize }]}>Google Play</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 12, paddingVertical: 9, paddingHorizontal: 16, alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  badgeSm: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 10 },
  small: { color: '#fff', fontSize: 9, fontWeight: '600', letterSpacing: 0.8, opacity: 0.9, textTransform: 'uppercase' },
  big: { color: '#fff', fontWeight: '800', letterSpacing: -0.2, marginTop: 1 },
});
