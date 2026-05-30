import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAddAccount } from '../../hooks/useAccounts';
import { useAppColors } from '../../hooks/useAppColors';


const TYPES = [
  { value: 'checking', label: 'Courant' },
  { value: 'savings', label: 'Épargne' },
  { value: 'investment', label: 'Investissement' },
  { value: 'other', label: 'Autre' },
];

export default function AddAccountScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const addAccount = useAddAccount(user?.id);

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('EUR');
  const [balance, setBalance] = useState('0');

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', 'Donnez un nom au compte.');
      return;
    }
    const num = parseFloat(balance.replace(',', '.'));
    if (Number.isNaN(num)) {
      Alert.alert('Solde invalide', 'Saisissez un nombre.');
      return;
    }

    try {
      await addAccount.mutateAsync({
        name: trimmed,
        type,
        currency: currency || 'EUR',
        balance: num,
      });

      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’enregistrer.');
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <Text style={styles.text}>Connectez-vous pour ajouter un compte.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Nouveau compte</Text>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Nom du compte</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Ex. Compte courant"
            placeholderTextColor={COLORS.textSecondary}
          />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[styles.chip, type === t.value && styles.chipActive]}
                onPress={() => setType(t.value)}
              >
                <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Devise</Text>
          <TextInput
            style={styles.input}
            value={currency}
            onChangeText={setCurrency}
            placeholder="EUR"
            placeholderTextColor={COLORS.textSecondary}
          />

          <Text style={styles.label}>Solde initial</Text>
          <TextInput
            style={styles.input}
            value={balance}
            onChangeText={setBalance}
            placeholder="0"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <TouchableOpacity
            style={[styles.submitBtn, addAccount.isPending && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={addAccount.isPending}
            accessibilityRole="button"
          >
            {addAccount.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.submitLabel}>Créer le compte</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
    marginBottom: 20,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  text: { color: c.text, marginBottom: 16 },
  btn: { backgroundColor: c.card, padding: 14, borderRadius: 12, alignSelf: 'flex-start' },
  btnLabel: { color: c.text, fontWeight: '600' },
  submitBtn: { backgroundColor: c.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
});
}
