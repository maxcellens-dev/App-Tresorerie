import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useFiscalEnvelopeRates, useUpdateFiscalRate, type FiscalEnvelope } from '../../hooks/useFiscalEnvelopes';

export default function FiscalRatesAdmin() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: rates = [], isLoading } = useFiscalEnvelopeRates();
  const updateRate = useUpdateFiscalRate(user?.id);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (rates.length && Object.keys(draft).length === 0) {
      const d: Record<string, string> = {};
      const n: Record<string, string> = {};
      rates.forEach((r) => { d[r.envelope] = String(r.tax_rate); n[r.envelope] = r.note ?? ''; });
      setDraft(d);
      setNotes(n);
    }
  }, [rates]);

  async function save(envelope: FiscalEnvelope) {
    const val = parseFloat((draft[envelope] ?? '').replace(',', '.'));
    if (Number.isNaN(val) || val < 0 || val > 100) {
      Alert.alert('Valeur invalide', 'Saisissez un taux entre 0 et 100.');
      return;
    }
    try {
      await updateRate.mutateAsync({ envelope, tax_rate: val, note: notes[envelope] ?? '' });
      Alert.alert('Enregistré', 'Le taux et la note ont été mis à jour.');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.bg === '#020617' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Fiscalité des investissements</Text>
        <Text style={styles.subtitle}>
          Taux par défaut dans la page Projection. Convention : taux « long terme » (PEA après 5 ans, AV après 8 ans = 17,2 % de prélèvements sociaux). L'utilisateur peut ajuster le % pour une projection courte.
        </Text>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isLoading && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />}
          {rates.map((r) => (
            <View key={r.envelope} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.envLabel}>{r.label}</Text>
                <Text style={styles.envCode}>{r.envelope.toUpperCase()}</Text>
              </View>
              <View style={styles.editRow}>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={draft[r.envelope] ?? ''}
                    onChangeText={(t) => setDraft((d) => ({ ...d, [r.envelope]: t.replace(/[^0-9.,]/g, '') }))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.suffix}>%</Text>
                </View>
              </View>
              <Text style={styles.noteLabel}>Note (affichée dans la création de compte et la projection)</Text>
              <TextInput
                style={styles.noteInput}
                value={notes[r.envelope] ?? ''}
                onChangeText={(t) => setNotes((n) => ({ ...n, [r.envelope]: t }))}
                multiline
                numberOfLines={3}
                placeholder="Explication de la fiscalité…"
                placeholderTextColor={COLORS.textSecondary}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.saveBtn, updateRate.isPending && { opacity: 0.6 }]}
                onPress={() => save(r.envelope)}
                disabled={updateRate.isPending}
              >
                <Text style={styles.saveBtnText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text },
    title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 4 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16, lineHeight: 18 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 100 },
    card: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
      padding: 16, marginBottom: 12, gap: 12,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    envLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    envCode: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
    editRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    inputWrap: {
      flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12,
    },
    input: { flex: 1, color: c.text, fontSize: 16, fontWeight: '700', paddingVertical: 10 },
    suffix: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
    noteLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
    noteInput: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, minHeight: 64,
    },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { color: c.bg, fontWeight: '700', fontSize: 14 },
  });
}
