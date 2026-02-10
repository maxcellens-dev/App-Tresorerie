import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAccounts, useUpdateAccount, useCloseAccount } from '../../../hooks/useAccounts';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
};

const TYPES = [
  { value: 'checking', label: 'Courant' },
  { value: 'savings', label: 'Épargne' },
  { value: 'investment', label: 'Investissement' },
  { value: 'other', label: 'Autre' },
];

export default function EditAccountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const updateAccount = useUpdateAccount(user?.id);
  const closeAccount = useCloseAccount(user?.id);

  const account = accounts.find((a) => a.id === id);

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('EUR');

  useEffect(() => {
    if (account) {
      setName(account.name);
      setType(account.type);
      setCurrency(account.currency);
    }
  }, [account]);

  async function handleSubmit() {
    if (!id) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', 'Donnez un nom au compte.');
      return;
    }
    try {
      await updateAccount.mutateAsync({
        id,
        name: trimmed,
        type,
        currency: currency || 'EUR',
      });
      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’enregistrer.');
    }
  }

  const doClose = () => {
    if (!id) return;
    closeAccount.mutateAsync(id).then(() => router.back()).catch((e: unknown) => {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de fermer le compte.');
    });
  };

  function handleClose() {
    if (!id) return;
    const closeMessage =
      "Un compte avec des écritures sera archivé (visible en bas de la liste). Un compte sans écriture sera supprimé. Vous ne pourrez plus l\u2019utiliser pour des virements ou nouvelles transactions. Confirmer ?";
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Fermer le compte\n\n' + closeMessage)) doClose();
      return;
    }
    Alert.alert(
      'Fermer le compte',
      'Un compte avec des écritures sera archivé (visible en bas de la liste). Un compte sans écriture sera supprimé. Vous ne pourrez plus l’utiliser pour des virements ou nouvelles transactions. Confirmer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Fermer le compte',
          style: 'destructive',
          onPress: doClose,
        },
      ]
    );
  }

  if (!user || !account) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.text}>{account ? 'Compte introuvable.' : 'Chargement…'}</Text>
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
        </TouchableOpacity>
        <Text style={styles.title}>Modifier le compte</Text>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Nom du compte</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Ex. Compte courant" placeholderTextColor={COLORS.textSecondary} />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t.value} style={[styles.chip, type === t.value && styles.chipActive]} onPress={() => setType(t.value)}>
                <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Devise</Text>
          <TextInput style={styles.input} value={currency} onChangeText={setCurrency} placeholder="EUR" placeholderTextColor={COLORS.textSecondary} />

          <View style={styles.balanceInfo}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.balanceInfoText}>Le solde ne peut être modifié qu'via des transactions.</Text>
          </View>

          <TouchableOpacity style={[styles.submitBtn, updateAccount.isPending && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={updateAccount.isPending} accessibilityRole="button">
            {updateAccount.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.submitLabel}>Enregistrer</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.closeBtn, closeAccount.isPending && styles.submitBtnDisabled]}
            onPress={handleClose}
            disabled={closeAccount.isPending}
            accessibilityRole="button"
          >
            {closeAccount.isPending ? <ActivityIndicator color={COLORS.danger} /> : <Text style={styles.closeBtnLabel}>Fermer le compte</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 20,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COLORS.cardBorder },
  chipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  chipText: { fontSize: 14, color: COLORS.text },
  chipTextActive: { color: COLORS.bg, fontWeight: '600' },
  text: { color: COLORS.text },
  submitBtn: { backgroundColor: COLORS.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  closeBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: COLORS.danger },
  closeBtnLabel: { fontSize: 16, fontWeight: '600', color: COLORS.danger },
  balanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 20,
  },
  balanceInfoText: { fontSize: 13, color: COLORS.textSecondary, flex: 1 },
});
