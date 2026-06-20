import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Alert } from 'react-native';
import ScreenGradient from '../../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAccounts, useUpdateAccount, useCloseAccount } from '../../../../hooks/useAccounts';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useFiscalEnvelopeRates } from '../../../../hooks/useFiscalEnvelopes';


const TYPES = [
  { value: 'checking', label: 'Courant' },
  { value: 'savings', label: 'Épargne' },
  { value: 'investment', label: 'Investissement' },
  { value: 'other', label: 'Autre' },
];

export default function EditAccountScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const updateAccount = useUpdateAccount(user?.id);
  const closeAccount = useCloseAccount(user?.id);
  const { data: fiscalRates = [] } = useFiscalEnvelopeRates();

  const account = accounts.find((a) => a.id === id);

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('EUR');
  const [fiscalEnvelope, setFiscalEnvelope] = useState<string>('pea');
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (account) {
      setName(account.name);
      setType(account.type);
      setCurrency(account.currency);
      setFiscalEnvelope((account as any).fiscal_envelope ?? 'pea');
    }
  }, [account]);

  async function handleSubmit() {
    if (!id) return;
    setFormError(null);
    setErrorFields([]);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Le nom du compte est obligatoire.');
      setErrorFields(['name']);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    try {
      await updateAccount.mutateAsync({
        id,
        name: trimmed,
        type,
        currency: currency || 'EUR',
        fiscal_envelope: type === 'investment' ? fiscalEnvelope : null,
      });
      router.back();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Impossible d'enregistrer.");
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  const doClose = () => {
    if (!id) return;
    closeAccount.mutateAsync(id).then(() => router.back()).catch((e: unknown) => {
      setFormError(e instanceof Error ? e.message : 'Impossible de fermer le compte.');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  function handleClose() {
    if (!id) return;
    const closeMessage =
      "Un compte avec des écritures sera archivé (visible en bas de la liste). Un compte sans écriture sera supprimé. Vous ne pourrez plus l\u2019utiliser pour des virements ou nouvelles transactions. Confirmer ?";
    Alert.alert(
      'Fermer le compte',
      "Un compte avec des écritures sera archivé (visible en bas de la liste). Un compte sans écriture sera supprimé. Vous ne pourrez plus l'utiliser pour des virements ou nouvelles transactions. Confirmer ?",
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
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.text}>{account ? 'Compte introuvable.' : 'Chargement…'}</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Modifier le compte</Text>

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {formError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{formError}</Text>
            </View>
          )}
          <Text style={styles.label}>Nom du compte *</Text>
          <TextInput
            style={[styles.input, errorFields.includes('name') && styles.inputError]}
            value={name}
            onChangeText={(v) => { setName(v); setErrorFields((p) => p.filter((f) => f !== 'name')); setFormError(null); }}
            placeholder="Ex. Compte courant"
            placeholderTextColor={COLORS.textSecondary}
          />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t.value} style={[styles.chip, type === t.value && styles.chipActive]} onPress={() => setType(t.value)}>
                <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {type === 'investment' && (
            <>
              <Text style={styles.label}>Enveloppe fiscale</Text>
              <View style={styles.chipRow}>
                {fiscalRates.map((r) => (
                  <TouchableOpacity
                    key={r.envelope}
                    style={[styles.chip, fiscalEnvelope === r.envelope && styles.chipActive]}
                    onPress={() => setFiscalEnvelope(r.envelope)}
                  >
                    <Text style={[styles.chipText, fiscalEnvelope === r.envelope && styles.chipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={styles.balanceInfo}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.balanceInfoText}>Le solde ne peut être modifié que via des transactions.</Text>
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
  inputError: { borderColor: c.danger },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: c.danger + '1F',
    borderWidth: 1,
    borderColor: c.danger + '66',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: c.danger, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  hintSmall: { fontSize: 11, color: c.textSecondary, marginTop: -12, marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  text: { color: c.text },
  submitBtn: { backgroundColor: c.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  closeBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: c.danger },
  closeBtnLabel: { fontSize: 16, fontWeight: '600', color: c.danger },
  balanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 20,
  },
  balanceInfoText: { fontSize: 13, color: c.textSecondary, flex: 1 },
});
}
