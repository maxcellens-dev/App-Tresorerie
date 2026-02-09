import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
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

export default function ThemeScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <Text style={styles.subtitle}>Personnalisation de l'apparence. Les options avancées (couleurs, polices) seront disponibles depuis le panneau Admin.</Text>
        <View style={styles.card}>
          <Text style={styles.cardText}>Thème actuel : Sombre (Modern Dark Fintech)</Text>
          <Text style={styles.hint}>Pour modifier le thème global (couleurs, textes SEO), utilisez le panneau Admin web.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
  },
  cardText: { fontSize: 16, color: COLORS.text, marginBottom: 12 },
  hint: { fontSize: 13, color: COLORS.textSecondary },
});
