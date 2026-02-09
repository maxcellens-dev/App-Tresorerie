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

export default function AboutScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <Text style={styles.tagline}>Santé financière prédictive</Text>
        <View style={styles.card}>
          <Text style={styles.version}>Version 1.0</Text>
          <Text style={styles.desc}>
            Plan de trésorerie, transactions récurrentes, comptes et catégories. Safe-to-Spend et prévisions alimentées par vos données.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  tagline: { fontSize: 16, color: COLORS.emerald, marginBottom: 24 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
  },
  version: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 },
  desc: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
});
