/**
 * Admin — L'ÉTAT DES LIEUX.
 *  • Activation globale + les deux temps (live / mensuel).
 *  • Signaux retenus PAR PROFIL P0–P9 (l'ordre de sélection est l'ordre d'affichage).
 *  • Aperçu du rendu réel (ouvre le vrai bilan, sans consommer le mois de l'utilisateur).
 *
 * ⚠️ PLUS AUCUN JUGEMENT. Il n'y a plus ni « repères » par profil (matelas visé, taux d'épargne,
 * part de la capacité d'investissement), ni couleurs d'état (vert / orange / rouge) : le bilan
 * donne une VISION d'un mois donné, il ne distribue pas de bons points. Les succès « mois au
 * vert » ont été retirés en conséquence.
 *
 * Le « point de la semaine » a été supprimé (rendez-vous unique : le mensuel).
 *
 * Stocké dans app_config.pulse (migrations 140 → 171).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import type { AppColors } from '../../../../theme/palette';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { usePulseConfig, useSavePulseConfig } from '../../../../hooks/pulse/usePulseConfig';
import { openPulse } from '../../../../components/pulse/PulseHost';
import {
  PULSE_SIGNAL_IDS, PULSE_SIGNAL_LABELS, DEFAULT_PULSE_CONFIG,
  type PulseConfig, type PulseSignalId,
} from '../../../../lib/pulse/pulseEngine';
import { PROFILE_INFO, FINANCIAL_PROFILE_IDS } from '../../../../lib/finance/financialProfileEngine';
import type { FinancialProfileId } from '../../../../types/database';

// Liste DÉRIVÉE du référentiel : un profil ajouté doit apparaître ici sans qu'on y pense.
const PROFILES: FinancialProfileId[] = FINANCIAL_PROFILE_IDS;

/** Signaux TOUJOURS présents en tête du bilan (ils composent la carte de récapitulatif). */
const ALWAYS_ON: PulseSignalId[] = ['spending', 'cushion'];

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
    if (next.length === 0) return;                  // un profil sans aucun signal n'aurait pas de bilan
    patch({ signalsByProfile: { ...draft.signalsByProfile, [profile]: next } });
  };

  const save = () => {
    if (!draft) return;
    saveCfg.mutate(draft, { onSuccess: () => { setDirty(false); setSavedAt(Date.now()); } });
  };

  const resetDefaults = () => { setDraft(DEFAULT_PULSE_CONFIG); setDirty(true); };

  if (!draft) {
    return (
      <View style={styles.root}>
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="État des lieux" onBack={goBack} />
          <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="État des lieux" onBack={goBack} />

        <ScrollView contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.p}>
            Le bilan du mois écoulé : des constats chiffrés, posés côte à côte. Aucun objectif n’est
            demandé à l’utilisateur, et rien n’est jugé — pas de vert, pas de rouge, pas de note.
          </Text>

          {/* ── Les deux temps ── */}
          <Text style={styles.h2}>Quand ça apparaît</Text>
          <View style={styles.card}>
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="L’état des lieux est actif"
              help="Désactivé : plus aucun bilan nulle part (rendez-vous mensuel, carte de confirmation de saisie)."
              value={draft.enabled}
              onChange={(v) => patch({ enabled: v })}
            />
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="À chaque saisie"
              help="La carte « C’est enregistré » après une dépense, une recette ou un virement : l’effet direct, le Relyka et le solde de fin de mois."
              value={draft.live}
              onChange={(v) => patch({ live: v })}
            />
            <ToggleRow
              styles={styles} COLORS={COLORS}
              label="État des lieux du mois"
              help="Le bilan du mois écoulé. Il n’arrive PAS le 1er : il attend que l’utilisateur ait clôturé tous ses mois en attente — sinon il porterait sur des chiffres qu’il n’a pas encore vérifiés."
              value={draft.monthly}
              onChange={(v) => patch({ monthly: v })}
              last
            />
          </View>

          <TouchableOpacity style={styles.previewBtn} onPress={() => openPulse(false)}>
            <Ionicons name="eye-outline" size={15} color={COLORS.emerald} />
            <Text style={styles.previewTxt}>Voir l’état des lieux</Text>
          </TouchableOpacity>
          <Text style={styles.note}>
            L’aperçu ouvre le VRAI bilan sur ton propre compte, sans consommer le mois (le rendez-vous
            de l’utilisateur arrivera quand même).
          </Text>

          {/* ── Ce que contient le rendez-vous ────────────────────────────────────────────────── */}
          <Text style={styles.h2}>Ce que contient le bilan</Text>
          <View style={styles.card}>
            <Text style={styles.p}>
              Les chiffres portent sur le <Text style={styles.strong}>mois écoulé</Text> (et non « à
              date ») : dépensé, mis de côté, placé et conservé de CE mois-là. Les signaux qui
              décrivent un état — matelas, patrimoine, fin de mois — restent, eux, à date.
            </Text>
            {[
              ['1', 'Une carte de récapitulatif', 'l’anneau (mis de côté · placé · conservé), et à côté deux lignes : dépenses variables, matelas de sécurité'],
              ['2', 'Ton projet', 'sa carte habituelle, et seulement s’il y a un projet en cours'],
              ['3', 'Fin de mois', 'sa carte habituelle, puis le reste de ta sélection ci-dessous'],
            ].map(([n, t, d]) => (
              <View key={n} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{n}</Text></View>
                <Text style={styles.stepTxt}>
                  <Text style={styles.strong}>{t}</Text> — {d}
                </Text>
              </View>
            ))}
            <Text style={styles.note}>
              « Dépenses variables » et « Matelas de sécurité » ouvrent toujours le bilan, quel que
              soit le profil : ce sont les deux lignes de la carte de récapitulatif.
            </Text>
          </View>

          {/* ── Signaux par profil ── */}
          <Text style={styles.h2}>Signaux, par profil</Text>
          <Text style={styles.p}>
            Le patrimoine ne parle qu’à ceux qui en ont un ; un débutant a plus besoin de savoir où il
            finira le mois. Choisis ce qui est montré à chacun — l’ordre de sélection est l’ordre
            d’affichage, après la carte de récapitulatif.
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
                const always = ALWAYS_ON.includes(id);
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
                    {always && <Text style={styles.alwaysTxt}>toujours affiché</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

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
    h2: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 24, marginBottom: 8 },
    p: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 10 },
    note: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, fontStyle: 'italic', marginTop: 8 },
    strong: { fontWeight: '700', color: c.text },
    stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 8 },
    stepNum: {
      width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.emerald + '22', marginTop: 1,
    },
    stepNumTxt: { fontSize: 11, fontWeight: '800', color: c.emerald },
    stepTxt: { flex: 1, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    fieldLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    fieldHelp: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 2 },
    previewBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10,
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
    alwaysTxt: { fontSize: 10, fontWeight: '700', color: c.textSecondary, fontStyle: 'italic' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 26 },
    resetBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    resetTxt: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    saveBtn: { flex: 2, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: c.emerald },
    saveTxt: { fontSize: 15, fontWeight: '800', color: c.bg },
    saved: { fontSize: 12.5, color: c.emerald, textAlign: 'center', marginTop: 10, fontWeight: '700' },
  });
}
