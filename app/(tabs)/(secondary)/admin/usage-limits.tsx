/**
 * Admin — Limites d'usage (anti-abus).
 * Édite les limites FREE et PREMIUM (app_config.usage_limits). Le blocage réel est en base
 * (migration 135) ; ces valeurs sont lues par les triggers ET par le garde-fou client.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/ScreenHeader';
import ScreenGradient from '../../../../components/ScreenGradient';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useResponsive } from '../../../../hooks/useResponsive';
import { pageColumn } from '../../../../lib/webLayout';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useUsageLimitsConfig, useSaveUsageLimitsConfig } from '../../../../hooks/useUsageLimits';
import { USAGE_LIMIT_FIELDS, USAGE_LIMIT_DEFAULTS, type UsageLimitsConfig, type UsageTierLimits } from '../../../../lib/usageLimits';

type Tier = 'free' | 'premium';

export default function AdminUsageLimits() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { data: cfg } = useUsageLimitsConfig();
  const save = useSaveUsageLimitsConfig();

  const [draft, setDraft] = useState<Record<Tier, Record<string, string>>>({ free: {}, premium: {} });
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (cfg && !dirty) {
      const d: Record<Tier, Record<string, string>> = { free: {}, premium: {} };
      (['free', 'premium'] as Tier[]).forEach((t) => {
        USAGE_LIMIT_FIELDS.forEach((f) => { d[t][f.key] = String(cfg[t][f.key]); });
      });
      setDraft(d);
    }
  }, [cfg, dirty]);

  const saveAll = () => {
    const next: UsageLimitsConfig = { free: { ...USAGE_LIMIT_DEFAULTS.free }, premium: { ...USAGE_LIMIT_DEFAULTS.premium } };
    (['free', 'premium'] as Tier[]).forEach((t) => {
      USAGE_LIMIT_FIELDS.forEach((f) => {
        const v = parseInt((draft[t][f.key] ?? '').replace(/[^0-9]/g, ''), 10);
        if (Number.isFinite(v)) (next[t] as any)[f.key as keyof UsageTierLimits] = v;
      });
    });
    save.mutate(next, { onSuccess: () => { setDirty(false); setSavedAt(Date.now()); } });
  };

  const setVal = (tier: Tier, key: string, v: string) => {
    setDirty(true);
    setDraft((p) => ({ ...p, [tier]: { ...p[tier], [key]: v.replace(/[^0-9]/g, '') } }));
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Limites d'usage" onBack={goBack} />
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.p}>
            Nombre maximal d'éléments par utilisateur. Au-delà, la création est bloquée et l'utilisateur
            est invité à passer Premium (ou à faire de la place). Les transactions sont comptées par
            date (mois/année de la transaction) ; comptes, projets, crédits et conversations IA au total.
          </Text>

          <View style={styles.headerRow}>
            <Text style={[styles.colLabel, { flex: 1 }]} />
            <Text style={[styles.colLabel, styles.colNum]}>Gratuit</Text>
            <Text style={[styles.colLabel, styles.colNum]}>Premium</Text>
          </View>

          {USAGE_LIMIT_FIELDS.map((f) => (
            <View key={f.key} style={styles.row}>
              <Text style={[styles.fieldLabel, { flex: 1 }]}>{f.label}</Text>
              <TextInput
                style={[styles.input, styles.colNum]}
                value={draft.free[f.key] ?? ''}
                onChangeText={(v) => setVal('free', f.key, v)}
                keyboardType="number-pad"
                placeholderTextColor={COLORS.textSecondary}
              />
              <TextInput
                style={[styles.input, styles.colNum]}
                value={draft.premium[f.key] ?? ''}
                onChangeText={(v) => setVal('premium', f.key, v)}
                keyboardType="number-pad"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>
          ))}

          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || save.isPending) && styles.saveBtnDisabled]}
            onPress={saveAll}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
            <Text style={styles.saveBtnTxt}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Text>
          </TouchableOpacity>
          {!dirty && savedAt != null && !save.isPending && <Text style={styles.savedTxt}>Modifications enregistrées ✓</Text>}
          {save.isError && <Text style={styles.errorTxt}>Échec de l'enregistrement — réessaie.</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19, marginBottom: 12 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 4 },
    colLabel: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
    colNum: { width: 84 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    fieldLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 12, marginTop: 18 },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
    savedTxt: { fontSize: 12.5, color: c.emerald, fontWeight: '600', textAlign: 'center', marginTop: 8 },
    errorTxt: { fontSize: 12.5, color: c.red, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  });
}
