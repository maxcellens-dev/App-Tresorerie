import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function ReportingScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // No specific data to refresh, just simulate completion
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#34d399"
              progressBackgroundColor="#0f172a"
            />
          }
        >
          <Text style={styles.subtitle}>Tableaux de bord et analyses à venir.</Text>
          {user ? (
            <View style={styles.card}>
              <Ionicons name="bar-chart-outline" size={48} color={COLORS.textSecondary} style={styles.icon} />
              <Text style={styles.message}>Graphiques, récapitulatifs par période et par catégorie seront disponibles ici.</Text>
            </View>
          ) : (
            <Text style={styles.hint}>Connectez-vous pour accéder au reporting.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 24,
    alignItems: 'center',
  },
  icon: { marginBottom: 16 },
  message: { fontSize: 15, color: COLORS.text, textAlign: 'center' },
  hint: { color: COLORS.textSecondary },
});
