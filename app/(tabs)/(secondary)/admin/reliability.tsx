/**
 * Admin — Fiabilité & confiance.
 *  - Seuils de doute (confiance haute/basse), biais et arrondi des fourchettes.
 *  - Catalogue documenté des NOTIFICATIONS SYSTÈME (soft_close, confidence_low…) avec activation.
 * Stocké dans app_config.reliability / app_config.system_notifications.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Switch, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import {
  useReliabilityConfig, useSaveReliabilityConfig,
  useSystemNotificationsConfig, useSaveSystemNotificationsConfig,
} from '../../../../hooks/useReliability';
import { RELIABILITY_DEFAULTS, type ReliabilityConfig } from '../../../../lib/confidenceEngine';
import { SYSTEM_NOTIFICATIONS, isSystemNotificationEnabled } from '../../../../lib/systemNotifications';

const NUM_FIELDS: { key: keyof ReliabilityConfig; label: string; help: string; pct?: boolean }[] = [
  { key: 'highMax', label: 'Seuil confiance haute', help: 'doute < X → chiffres nets', pct: true },
  { key: 'lowMin', label: 'Seuil confiance basse', help: 'doute ≥ X → fourchettes larges + alerte', pct: true },
  { key: 'coldStartWeeklyFraction', label: 'Dérive cold start / semaine', help: 'part de la base présumée dérivée par semaine sans vérif', pct: true },
  { key: 'coldStartDays', label: 'Jours présumés au cold start', help: 'ancienneté supposée sans date de vérif' },
  { key: 'absoluteFloor', label: 'Plancher absolu (€)', help: 'base minimale du doute (évite /0)' },
  { key: 'upBias', label: 'Biais borne haute', help: '0.3 = le non-saisi tire surtout vers le bas' },
  { key: 'roundStep', label: 'Arrondi fourchettes (€)', help: 'pas d’arrondi (100 = centaine)' },
];

export default function AdminReliability() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const { data: cfg } = useReliabilityConfig();
  const saveCfg = useSaveReliabilityConfig();
  const { data: notifCfg } = useSystemNotificationsConfig();
  const saveNotif = useSaveSystemNotificationsConfig();

  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (cfg) {
      const d: Record<string, string> = {};
      for (const f of NUM_FIELDS) d[f.key] = String(cfg[f.key]);
      setDraft(d);
    }
  }, [cfg]);

  const saveField = (key: keyof ReliabilityConfig) => {
    const raw = (draft[key] ?? '').replace(',', '.');
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return;
    saveCfg.mutate({ [key]: v } as Partial<ReliabilityConfig>);
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.back} onPress={goBack}><Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backTxt}>Retour</Text></TouchableOpacity>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.h1}>Fiabilité & confiance</Text>
          <Text style={styles.p}>
            Ces réglages pilotent le « doute » qui met le Relyka, les recommandations et la projection en
            fourchette. Une seule formule les alimente tous.
          </Text>

          <Text style={styles.section}>Seuils de doute</Text>
          {NUM_FIELDS.map((f) => (
            <View key={f.key} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{f.label}</Text>
                <Text style={styles.help}>{f.help} · défaut {String(RELIABILITY_DEFAULTS[f.key])}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={draft[f.key] ?? ''}
                onChangeText={(v) => setDraft((p) => ({ ...p, [f.key]: v.replace(/[^0-9.,]/g, '') }))}
                onEndEditing={() => saveField(f.key)}
                keyboardType="decimal-pad"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>
          ))}
          {saveCfg.isPending && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 8 }} />}

          <Text style={styles.section}>Notifications système</Text>
          <Text style={styles.p}>Déclenchées par le moteur d’état. Documentées ci-dessous, activables une par une.</Text>
          {SYSTEM_NOTIFICATIONS.map((n) => {
            const enabled = isSystemNotificationEnabled(n.id, notifCfg);
            return (
              <View key={n.id} style={styles.notifCard}>
                <View style={styles.notifHead}>
                  <Text style={styles.notifTitle}>{n.title}</Text>
                  <Switch
                    value={enabled}
                    onValueChange={(v) => saveNotif.mutate({ [n.id]: { enabled: v } })}
                    trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
                  />
                </View>
                <Text style={styles.notifId}>{n.id}</Text>
                <Text style={styles.notifBody}>« {n.bodyExample} »</Text>
                <Text style={styles.notifMeta}>Quand : {n.condition}</Text>
                <Text style={styles.notifMeta}>Fréquence max : {n.maxFrequency}</Text>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backTxt: { fontSize: 14, fontWeight: '600', color: c.text },
    h1: { fontSize: 22, fontWeight: '800', color: c.text, marginTop: 4 },
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
    section: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    label: { fontSize: 14, fontWeight: '600', color: c.text },
    help: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    input: { width: 90, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    notifCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    notifHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    notifTitle: { fontSize: 14.5, fontWeight: '800', color: c.text, flex: 1, marginRight: 10 },
    notifId: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: c.emerald, marginTop: 2 },
    notifBody: { fontSize: 12.5, color: c.text, fontStyle: 'italic', marginTop: 6 },
    notifMeta: { fontSize: 11.5, color: c.textSecondary, marginTop: 4 },
  });
}
