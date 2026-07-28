/**
 * Admin — LE POULS.
 *  • Activation globale + les trois temps (live / hebdo / mensuel).
 *  • Signaux retenus PAR PROFIL P1–P5 (l'ordre d'affichage est celui de la sélection).
 *  • Repères par profil (matelas visé, taux d'épargne, part de la capacité d'investissement).
 *  • Notification hebdo : rien ici — c'est une notification PLANIFIÉE récurrente « Hebdo »
 *    (Admin → Notifications → Planifier), envoyée par send-scheduled-notifications via le cron.
 *  • Aperçu du rendu réel (ouvre le vrai Pouls, sans consommer la période de l'utilisateur).
 *
 * Stocké dans app_config.pulse (migration 140).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useResponsive } from '../../../../hooks/useResponsive';
import { pageColumn } from '../../../../lib/webLayout';
import type { AppColors } from '../../../../theme/palette';
import { useNavBack } from '../../../../hooks/useNavBack';
import { usePulseConfig, useSavePulseConfig } from '../../../../hooks/usePulseConfig';
import { openPulse } from '../../../../components/PulseHost';
import {
  PULSE_SIGNAL_IDS, PULSE_SIGNAL_LABELS, DEFAULT_PULSE_CONFIG,
  type PulseConfig, type PulseSignalId, type PulseBenchmark,
} from '../../../../lib/pulseEngine';
import { PROFILE_INFO } from '../../../../lib/financialProfileEngine';
import type { FinancialProfileId } from '../../../../types/database';

const PROFILES: FinancialProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5'];

const BENCHMARK_FIELDS: { key: keyof PulseBenchmark; label: string; help: string }[] = [
  { key: 'cushionMonths', label: 'Matelas visé (mois)', help: 'Nombre de mois de revenus que l’épargne doit couvrir pour être « au vert ».' },
  { key: 'savingRatePct', label: 'Épargne du mois (% des revenus)', help: 'Part des revenus à mettre de côté chaque mois. 0 = le signal n’est plus jugé (profil qui n’a plus à épargner).' },
  { key: 'investOfCapacityPct', label: 'Investissement (% de la capacité)', help: 'Part de la capacité d’investissement du mois à utiliser pour être « au vert ». 0 = signal non jugé.' },
];

export default function AdminPouls() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { data: cfg } = usePulseConfig();
  const saveCfg = useSavePulseConfig();

  const [draft, setDraft] = useState<PulseConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [openProfile, setOpenProfile] = useState<FinancialProfileId>('P1');

  // Ne jamais écraser une saisie en cours (la config se rafraîchit au retour de focus).
  useEffect(() => { if (cfg && !dirty) setDraft(cfg); }, [cfg, dirty]);

  const patch = (next: Partial<PulseConfig>) => {
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));
    setDirty(true);
  };

  const toggleSignal = (profile: FinancialProfileId, signal: PulseSignalId) => {
    if (!draft) return;
    const current = draft.signalsByProfile[profile] ?? [];
    const next = current.includes(signal)
      ? current.filter((s) => s !== signal)
      : [...current, signal];                       // ajouté à la fin → l'ordre de sélection = l'ordre d'affichage
    if (next.length === 0) return;                  // un profil sans aucun signal n'aurait pas de Pouls
    patch({ signalsByProfile: { ...draft.signalsByProfile, [profile]: next } });
  };

  const setBenchmark = (profile: FinancialProfileId, key: keyof PulseBenchmark, raw: string) => {
    if (!draft) return;
    const value = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(value) || value < 0) return;
    patch({
      benchmarks: {
        ...draft.benchmarks,
        [profile]: { ...draft.benchmarks[profile], [key]: value },
      },
    });
  };

  const save = () => {
    if (!draft) return;
    saveCfg.mutate(draft, { onSuccess: () => { setDirty(false); setSavedAt(Date.now()); } });
  };

  const resetDefaults = () => { setDraft(DEFAULT_PULSE_CONFIG); setDirty(true); };

  if (!draft) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.back} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backTxt}>Retour</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.h1}>🧭 Le Point</Text>
          <Text style={styles.p}>
            L’état des lieux de la santé financière : des constats jugés par des repères liés au profil
            P1–P5. Aucun objectif n’est demandé à l’utilisateur — tout vient d’ici.
          </Text>

          {/* ── Les trois temps ── */}
          <Text style={styles.h2}>Quand ça apparaît</Text>
          <View style={styles.card}>
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="Le Point est actif"
              help="Désactivé : plus aucun Point nulle part (pastille, cartes, pastilles de saisie)."
              value={draft.enabled}
              onChange={(v) => patch({ enabled: v })}
            />
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="À chaque saisie"
              help="Les pastilles « ce qui vient de bouger » après une dépense, une recette ou un virement."
              value={draft.live}
              onChange={(v) => patch({ live: v })}
            />
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="Point de la semaine"
              help="Carte LÉGÈRE (3 signaux max : dépenses, fin de mois + le signal du mois du profil), à la 1ʳᵉ ouverture de la semaine."
              value={draft.weekly}
              onChange={(v) => patch({ weekly: v })}
            />
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="État des lieux du mois"
              help="Le bilan mensuel complet, une fois le mois précédent terminé. Prioritaire sur l’hebdo."
              value={draft.monthly}
              onChange={(v) => patch({ monthly: v })}
              last
            />
          </View>

          <View style={styles.previewRow}>
            <TouchableOpacity style={styles.previewBtn} onPress={() => openPulse('week', false)}>
              <Ionicons name="eye-outline" size={15} color={COLORS.emerald} />
              <Text style={styles.previewTxt}>Voir le Point hebdo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.previewBtn} onPress={() => openPulse('month', false)}>
              <Ionicons name="eye-outline" size={15} color={COLORS.emerald} />
              <Text style={styles.previewTxt}>Voir l’état des lieux</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.note}>
            L’aperçu ouvre le VRAI Point sur ton propre compte, sans consommer la période (le rendez-vous
            de l’utilisateur arrivera quand même).
          </Text>

          {/* ── Signaux & repères par profil ── */}
          <Text style={styles.h2}>Signaux & repères, par profil</Text>
          <Text style={styles.p}>
            Un débutant n’est pas jugé sur l’investissement ; un profil confirmé n’a plus à prouver qu’il
            épargne. Choisis ce qui est montré à chacun — l’ordre de sélection est l’ordre d’affichage.
          </Text>

          <View style={styles.tabs}>
            {PROFILES.map((p) => {
              const on = openProfile === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.tab, on && { backgroundColor: PROFILE_INFO[p].color + '22', borderColor: PROFILE_INFO[p].color }]}
                  onPress={() => setOpenProfile(p)}
                >
                  <Text style={[styles.tabTxt, on && { color: COLORS.text }]}>{PROFILE_INFO[p].emoji} {p}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.profileName}>{PROFILE_INFO[openProfile].name}</Text>
            <Text style={styles.profileDesc}>{PROFILE_INFO[openProfile].description}</Text>

            <Text style={styles.blockLabel}>Signaux affichés</Text>
            <View style={styles.signals}>
              {PULSE_SIGNAL_IDS.map((id) => {
                const list = draft.signalsByProfile[openProfile] ?? [];
                const index = list.indexOf(id);
                const on = index >= 0;
                return (
                  <TouchableOpacity
                    key={id}
                    style={[styles.signal, on && { backgroundColor: COLORS.emerald + '1A', borderColor: COLORS.emerald }]}
                    onPress={() => toggleSignal(openProfile, id)}
                  >
                    {on && <View style={styles.orderBadge}><Text style={styles.orderTxt}>{index + 1}</Text></View>}
                    <Text style={[styles.signalTxt, on && { color: COLORS.text, fontWeight: '700' }]}>
                      {PULSE_SIGNAL_LABELS[id]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.blockLabel}>Repères</Text>
            {BENCHMARK_FIELDS.map((field) => (
              <View key={field.key} style={styles.field}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text style={styles.fieldHelp}>{field.help}</Text>
                </View>
                <TextInput
                  style={styles.input}
                  value={String(draft.benchmarks[openProfile][field.key])}
                  onChangeText={(v) => setBenchmark(openProfile, field.key, v)}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>

          {/* NB : plus de section « Notification hebdomadaire » ici — le push hebdo du Point est une
              notification PLANIFIÉE récurrente (admin Notifications → Planifier), envoyée par le
              cron serveur comme la mensuelle. Une seule commande, pas de double config. */}

          {/* ── Enregistrement ── */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.resetBtn} onPress={resetDefaults}>
              <Text style={styles.resetTxt}>Réinitialiser</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!dirty || saveCfg.isPending) && { opacity: 0.5 }]}
              onPress={save}
              disabled={!dirty || saveCfg.isPending}
            >
              {saveCfg.isPending
                ? <ActivityIndicator color={COLORS.bg} size="small" />
                : <Text style={styles.saveTxt}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
          {savedAt && !dirty && <Text style={styles.saved}>✓ Enregistré</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function ToggleRow({ styles, COLORS, label, help, value, onChange, last }: {
  styles: any; COLORS: AppColors; label: string; help: string;
  value: boolean; onChange: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldHelp}>{help}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald + '88' }}
        thumbColor={value ? COLORS.emerald : COLORS.textSecondary}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    back: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    backTxt: { fontSize: 15, color: c.text, marginLeft: 4, fontWeight: '600' },
    h1: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 6 },
    h2: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 24, marginBottom: 8 },
    p: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 10 },
    note: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, fontStyle: 'italic', marginTop: 8 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    fieldLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    fieldHelp: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 2 },
    previewRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    previewBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderWidth: 1, borderColor: c.emerald, borderRadius: 12, paddingVertical: 11,
    },
    previewTxt: { fontSize: 12.5, fontWeight: '800', color: c.emerald },
    tabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    tabTxt: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    profileName: { fontSize: 16, fontWeight: '800', color: c.text },
    profileDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 3 },
    blockLabel: { fontSize: 11, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
    signals: { gap: 7 },
    signal: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 12,
    },
    orderBadge: { width: 19, height: 19, borderRadius: 999, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    orderTxt: { fontSize: 10.5, fontWeight: '800', color: c.bg },
    signalTxt: { flex: 1, fontSize: 13, color: c.textSecondary },
    field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    input: {
      width: 76, backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 9, fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'center',
    },
    actions: { flexDirection: 'row', gap: 10, marginTop: 26 },
    resetBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    resetTxt: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    saveBtn: { flex: 2, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: c.emerald },
    saveTxt: { fontSize: 15, fontWeight: '800', color: c.bg },
    saved: { fontSize: 12.5, color: c.emerald, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  });
}
