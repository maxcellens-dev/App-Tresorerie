import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function NotificationsScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.card}>
          <Ionicons name="notifications-outline" size={48} color={COLORS.textSecondary} style={styles.icon} />
          <Text style={styles.message}>La gestion des notifications sera disponible prochainement.</Text>
          <Text style={styles.hint}>Vous pourrez choisir les alertes (tréso, rappels, etc.) et les préférences d’envoi.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 24,
    alignItems: 'center',
  },
  icon: { marginBottom: 16 },
  message: { fontSize: 16, color: COLORS.text, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  hint: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
});
