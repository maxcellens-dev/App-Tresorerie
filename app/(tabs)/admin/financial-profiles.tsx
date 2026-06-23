import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import KeyboardAwareScrollView from '../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useProfileMatrixConfig,
  useProfileNotificationMessages,
  useUpdateNotificationMessage,
  useUpdateMatrixConfig,
  useFinancialProfile,
  useSimulateProfileChange,
} from '../../../hooks/useFinancialProfile';
import { PROFILE_INFO } from '../../../lib/financialProfileEngine';
import type { FinancialProfileId } from '../../../types/database';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { useSavingsConfig, useSaveSavingsConfig, SAVINGS_DEFAULTS } from '../../../hooks/useSavingsConfig';


type Tab = 'simulate' | 'messages' | 'matrix' | 'global';

const TABS: { key: Tab; label: string }[] = [
  { key: 'simulate', label: 'Simulation' },
  { key: 'messages', label: 'Messages' },
  { key: 'matrix',   label: 'Matrice' },
  { key: 'global',   label: 'Paramètres' },
];

const ALL_PROFILES: FinancialProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5'];

const TRANSITIONS = [
  { key: 'P1_P2', label: 'P1 → P2', from: 'P1' as FinancialProfileId, to: 'P2' as FinancialProfileId },
  { key: 'P2_P3', label: 'P2 → P3', from: 'P2' as FinancialProfileId, to: 'P3' as FinancialProfileId },
  { key: 'P3_P4', label: 'P3 → P4', from: 'P3' as FinancialProfileId, to: 'P4' as FinancialProfileId },
  { key: 'P4_P5', label: 'P4 → P5', from: 'P4' as FinancialProfileId, to: 'P5' as FinancialProfileId },
];

const DOWNGRADE_TRANSITIONS = [
  { key: 'P2_P1', label: 'P2 → P1' },
  { key: 'P3_P2', label: 'P3 → P2' },
  { key: 'P4_P3', label: 'P4 → P3' },
  { key: 'P5_P4', label: 'P5 → P4' },
];

const EXCEPTIONAL_TRANSITIONS = [
  { key: 'exceptional_one', label: 'Baisse de revenus (−1 niveau)' },
  { key: 'exceptional_two', label: 'Revenus nuls (−2 niveaux)' },
];

// Messages de « maintien » (bilan mensuel quand le profil ne change pas) — un par profil.
const MAINTAIN_TRANSITIONS = ALL_PROFILES.map((p) => ({ key: p, label: `${p} — maintien` }));

// ── Simulation (admin) ──────────────────────────────────────────

function SimulationSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: fp, isLoading } = useFinancialProfile(userId);
  const simulate = useSimulateProfileChange(userId);

  const current = (fp?.profile_id as FinancialProfileId | undefined) ?? null;
  const [target, setTarget] = useState<FinancialProfileId | null>(null);

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  if (!current) {
    return (
      <View style={styles.sectionContent}>
        <Text style={styles.matrixInfo}>
          Aucun profil financier actif sur ce compte. Termine d'abord le questionnaire pour pouvoir simuler une transition.
        </Text>
      </View>
    );
  }

  const currentNum = parseInt(current.replace('P', ''));
  const direction: 'upgrade' | 'downgrade' | null = !target
    ? null
    : parseInt(target.replace('P', '')) > currentNum ? 'upgrade' : 'downgrade';

  const trigger = (t: FinancialProfileId, reason: 'automatic_upgrade' | 'automatic_downgrade' | 'exceptional_revenue_drop' | 'monthly_recap') => {
    simulate.mutate({ target: t, reason }, {
      onSuccess: () => setTarget(null),
      onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec de la simulation.'),
    });
  };

  const exceptionalTarget = (levels: number): FinancialProfileId =>
    `P${Math.max(1, currentNum - levels)}` as FinancialProfileId;

  return (
    <View style={styles.sectionContent}>
      <Text style={styles.matrixInfo}>
        Force ton profil vers la cible choisie et affiche immédiatement la pop-up correspondante.
        Ignore les critères, le gel des 6 mois et la date de déclenchement. Le changement est réel.
      </Text>

      {/* Profil actuel */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Profil actuel</Text>
        <View style={styles.simCurrentRow}>
          <Text style={styles.simEmoji}>{PROFILE_INFO[current].emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.simName, { color: PROFILE_INFO[current].color }]}>{PROFILE_INFO[current].name}</Text>
            <Text style={styles.simTier}>{current} · {PROFILE_INFO[current].tier}</Text>
          </View>
        </View>
      </View>

      {/* Choix de la cible */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Profil cible</Text>
        <View style={styles.simChipRow}>
          {ALL_PROFILES.map((p) => {
            const isCurrent = p === current;
            const active = p === target;
            return (
              <TouchableOpacity
                key={p}
                disabled={isCurrent}
                onPress={() => setTarget(p)}
                style={[
                  styles.simChip,
                  isCurrent && styles.simChipDisabled,
                  active && { backgroundColor: PROFILE_INFO[p].color, borderColor: PROFILE_INFO[p].color },
                ]}
              >
                <Text style={styles.simChipEmoji}>{PROFILE_INFO[p].emoji}</Text>
                <Text style={[styles.simChipText, active && { color: '#fff' }, isCurrent && { color: COLORS.textSecondary }]}>
                  {p}{isCurrent ? ' (actuel)' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {target && direction && (
          <View style={[styles.simDirBadge, { backgroundColor: (direction === 'upgrade' ? COLORS.emerald : '#f87171') + '20' }]}>
            <Ionicons name={direction === 'upgrade' ? 'trending-up' : 'trending-down'} size={15} color={direction === 'upgrade' ? COLORS.emerald : '#f87171'} />
            <Text style={[styles.simDirText, { color: direction === 'upgrade' ? COLORS.emerald : '#f87171' }]}>
              {direction === 'upgrade' ? 'Montée' : 'Descente'} · {current} → {target}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, (!target || simulate.isPending) && { opacity: 0.5 }]}
          disabled={!target || simulate.isPending}
          onPress={() => target && direction && trigger(target, direction === 'upgrade' ? 'automatic_upgrade' : 'automatic_downgrade')}
        >
          {simulate.isPending
            ? <ActivityIndicator color={COLORS.bg} size="small" />
            : <Text style={styles.saveBtnText}>Déclencher la transition</Text>}
        </TouchableOpacity>
      </View>

      {/* Cas exceptionnels (baisse de revenus) */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Cas exceptionnels (baisse de revenus)</Text>
        <TouchableOpacity
          style={[styles.simExcBtn, (currentNum <= 1 || simulate.isPending) && { opacity: 0.5 }]}
          disabled={currentNum <= 1 || simulate.isPending}
          onPress={() => trigger(exceptionalTarget(1), 'exceptional_revenue_drop')}
        >
          <Ionicons name="warning-outline" size={16} color="#f59e0b" />
          <Text style={styles.simExcText}>Baisse de revenus (−1 niveau → {exceptionalTarget(1)})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.simExcBtn, (currentNum < 3 || simulate.isPending) && { opacity: 0.5 }]}
          disabled={currentNum < 3 || simulate.isPending}
          onPress={() => trigger(exceptionalTarget(2), 'exceptional_revenue_drop')}
        >
          <Ionicons name="warning-outline" size={16} color="#f59e0b" />
          <Text style={styles.simExcText}>Revenus nuls (−2 niveaux → {exceptionalTarget(2)})</Text>
        </TouchableOpacity>
      </View>

      {/* Bilan mensuel — message « maintien » (le profil ne change pas) */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Bilan mensuel (même profil)</Text>
        <TouchableOpacity
          style={[styles.simMaintainBtn, simulate.isPending && { opacity: 0.5 }]}
          disabled={simulate.isPending}
          onPress={() => trigger(current, 'monthly_recap')}
        >
          <Ionicons name="sync-outline" size={16} color="#60a5fa" />
          <Text style={styles.simExcText}>Message de maintien ({current})</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Messages de notification ────────────────────────────────────

function MessagesSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: messages = [], isLoading } = useProfileNotificationMessages();
  const updateMsg = useUpdateNotificationMessage(userId);

  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const allTransitions = [
    ...TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'upgrade' as const })),
    ...DOWNGRADE_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'downgrade' as const })),
    ...EXCEPTIONAL_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'exceptional' as const })),
    ...MAINTAIN_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'same' as const })),
  ];

  function startEdit(transition: string, direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same') {
    const msg = messages.find(m => m.transition === transition && m.direction === direction);
    setEditTitle(msg?.title ?? '');
    setEditBody(msg?.body ?? '');
    setEditing(`${transition}|${direction}`);
  }

  async function handleSave(transition: string, direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same') {
    if (!editTitle.trim()) { Alert.alert('Titre requis'); return; }
    try {
      await updateMsg.mutateAsync({ transition, direction, title: editTitle.trim(), body: editBody.trim() });
      setEditing(null);
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  return (
    <View style={styles.sectionContent}>
      {allTransitions.map(({ key: transition, label, direction }) => {
        const msg = messages.find(m => m.transition === transition && m.direction === direction);
        const editKey = `${transition}|${direction}`;
        const isEditing = editing === editKey;
        const dirColor = direction === 'upgrade' ? COLORS.emerald : direction === 'downgrade' ? '#f87171' : direction === 'same' ? '#60a5fa' : '#f59e0b';

        return (
          <View key={editKey} style={styles.msgCard}>
            <View style={styles.msgHeader}>
              <View style={[styles.dirBadge, { backgroundColor: dirColor + '20' }]}>
                <Text style={[styles.dirBadgeText, { color: dirColor }]}>
                  {direction === 'upgrade' ? '↑ Montée' : direction === 'downgrade' ? '↓ Descente' : direction === 'same' ? '↺ Maintien' : '⚠ Exceptionnel'}
                </Text>
              </View>
              <Text style={styles.msgTransition}>{label}</Text>
              <TouchableOpacity onPress={() => isEditing ? setEditing(null) : startEdit(transition, direction)}>
                <Ionicons name={isEditing ? 'close' : 'create-outline'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {isEditing ? (
              <View style={styles.editForm}>
                <Text style={styles.fieldLabel}>Titre</Text>
                <TextInput
                  style={styles.input}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  multiline
                  placeholderTextColor={COLORS.textSecondary}
                  placeholder="Titre du message"
                />
                <Text style={styles.fieldLabel}>Corps</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={editBody}
                  onChangeText={setEditBody}
                  multiline
                  numberOfLines={4}
                  placeholderTextColor={COLORS.textSecondary}
                  placeholder="Contenu du message"
                />
                <TouchableOpacity
                  style={[styles.saveBtn, updateMsg.isPending && { opacity: 0.6 }]}
                  onPress={() => handleSave(transition, direction)}
                  disabled={updateMsg.isPending}
                >
                  {updateMsg.isPending
                    ? <ActivityIndicator color={COLORS.bg} size="small" />
                    : <Text style={styles.saveBtnText}>Sauvegarder</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.msgPreview}>
                <Text style={styles.msgTitle} numberOfLines={2}>{msg?.title ?? '—'}</Text>
                <Text style={styles.msgBody} numberOfLines={3}>{msg?.body ?? '—'}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Matrice de seuils ───────────────────────────────────────────

function MatrixSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: configs = [], isLoading } = useProfileMatrixConfig();
  const updateConfig = useUpdateMatrixConfig(userId);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  function startEdit(transition: string) {
    const cfg = configs.find((c: any) => c.transition === transition);
    if (cfg) {
      setEditValues({
        upgrade_months_threshold: String(cfg.upgrade_months_threshold),
        upgrade_flux_threshold: String(cfg.upgrade_flux_threshold),
        downgrade_months_threshold: String(cfg.downgrade_months_threshold),
        downgrade_flux_threshold: String(cfg.downgrade_flux_threshold),
        anti_yoyo_months: String(cfg.anti_yoyo_months),
      });
    }
    setEditingKey(transition);
  }

  async function handleSave(transition: string) {
    try {
      await updateConfig.mutateAsync({
        transition,
        upgrade_months_threshold: parseFloat(editValues.upgrade_months_threshold) || 0,
        upgrade_flux_threshold: parseFloat(editValues.upgrade_flux_threshold) || 0,
        downgrade_months_threshold: parseFloat(editValues.downgrade_months_threshold) || 0,
        downgrade_flux_threshold: parseFloat(editValues.downgrade_flux_threshold) || 0,
        anti_yoyo_months: parseInt(editValues.anti_yoyo_months) || 2,
      });
      setEditingKey(null);
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  return (
    <View style={styles.sectionContent}>
      <Text style={styles.matrixInfo}>
        Les montées requièrent {'{anti_yoyo_months}'} mois consécutifs. Les descentes sont immédiates.
      </Text>

      {TRANSITIONS.map(({ key: transition, label, from, to }) => {
        const cfg = configs.find((c: any) => c.transition === transition);
        const isEditing = editingKey === transition;
        const fromInfo = PROFILE_INFO[from];
        const toInfo = PROFILE_INFO[to];

        return (
          <View key={transition} style={styles.matrixCard}>
            <View style={styles.matrixHeader}>
              <Text style={styles.matrixLabel}>
                {fromInfo.emoji} {fromInfo.name} → {toInfo.emoji} {toInfo.name}
              </Text>
              <TouchableOpacity onPress={() => isEditing ? setEditingKey(null) : startEdit(transition)}>
                <Ionicons name={isEditing ? 'close' : 'create-outline'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {isEditing ? (
              <View style={styles.editForm}>
                {[
                  { field: 'upgrade_months_threshold',   label: 'Montée — mois de sécurité ≥' },
                  { field: 'upgrade_flux_threshold',     label: 'Montée — flux total ≥ (%)' },
                  { field: 'downgrade_months_threshold', label: 'Descente — mois de sécurité <' },
                  { field: 'downgrade_flux_threshold',   label: 'Descente — flux total < (%)' },
                  { field: 'anti_yoyo_months',           label: 'Mois consécutifs requis (montée)' },
                ].map(({ field, label: fl }) => (
                  <View key={field} style={styles.matrixRow}>
                    <Text style={styles.matrixRowLabel}>{fl}</Text>
                    <TextInput
                      style={styles.matrixInput}
                      value={editValues[field]}
                      onChangeText={v => setEditValues(prev => ({ ...prev, [field]: v }))}
                      keyboardType="decimal-pad"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                <View style={styles.bufferRow}>
                  <Text style={styles.bufferLabel}>Écart tampon (calculé)</Text>
                  <Text style={styles.bufferValue}>
                    {(parseFloat(editValues.upgrade_months_threshold) - parseFloat(editValues.downgrade_months_threshold)).toFixed(1)} mois
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, updateConfig.isPending && { opacity: 0.6 }]}
                  onPress={() => handleSave(transition)}
                  disabled={updateConfig.isPending}
                >
                  {updateConfig.isPending
                    ? <ActivityIndicator color={COLORS.bg} size="small" />
                    : <Text style={styles.saveBtnText}>Sauvegarder</Text>}
                </TouchableOpacity>
              </View>
            ) : cfg ? (
              <View style={styles.matrixSummary}>
                <Text style={styles.matrixSummaryText}>
                  ↑ Montée : ≥ {cfg.upgrade_months_threshold} mois · ≥ {cfg.upgrade_flux_threshold} % flux
                </Text>
                <Text style={styles.matrixSummaryText}>
                  ↓ Descente : &lt; {cfg.downgrade_months_threshold} mois · &lt; {cfg.downgrade_flux_threshold} % flux
                </Text>
                <Text style={styles.matrixSummaryText}>
                  Anti-yoyo : {cfg.anti_yoyo_months} mois consécutifs
                </Text>
              </View>
            ) : (
              <Text style={{ color: COLORS.textSecondary }}>Non configuré</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Paramètres globaux ──────────────────────────────────────────

function GlobalSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: configs = [] } = useProfileMatrixConfig();
  const updateConfig = useUpdateMatrixConfig(userId);
  const [freeze, setFreeze] = useState('6');
  const [fluxWindow, setFluxWindow] = useState('3');
  const [expWindow, setExpWindow] = useState('6');
  const [dropThreshold, setDropThreshold] = useState('50');
  const [saving, setSaving] = useState(false);

  // ── Seuils d'épargne (globaux, en EUR) + libellés affichés (Comptes → vue d'ensemble) ──
  const { data: savingsCfg } = useSavingsConfig();
  const saveSavings = useSaveSavingsConfig();
  const [sv, setSv] = useState<Record<string, string>>({});
  useEffect(() => {
    const c = savingsCfg ?? SAVINGS_DEFAULTS;
    setSv({
      min: String(c.min), optimal: String(c.optimal), comfort: String(c.comfort),
      label_critical: c.label_critical, label_low: c.label_low, label_healthy: c.label_healthy, label_comfort: c.label_comfort,
    });
  }, [savingsCfg]);
  async function handleSaveSavings() {
    try {
      await saveSavings.mutateAsync({
        min: parseFloat(sv.min) || 0,
        optimal: parseFloat(sv.optimal) || 0,
        comfort: parseFloat(sv.comfort) || 0,
        label_critical: sv.label_critical?.trim() || SAVINGS_DEFAULTS.label_critical,
        label_low: sv.label_low?.trim() || SAVINGS_DEFAULTS.label_low,
        label_healthy: sv.label_healthy?.trim() || SAVINGS_DEFAULTS.label_healthy,
        label_comfort: sv.label_comfort?.trim() || SAVINGS_DEFAULTS.label_comfort,
      });
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  useEffect(() => {
    const first = configs[0] as any;
    if (first) {
      setFreeze(String(first.freeze_months ?? 6));
      setFluxWindow(String(first.flux_window_months ?? 3));
      setExpWindow(String(first.expenses_window_months ?? 6));
      setDropThreshold(String(first.exceptional_drop_threshold_pct ?? 50));
    }
  }, [configs.length]);

  async function handleSave() {
    setSaving(true);
    try {
      const transitions = ['P1_P2', 'P2_P3', 'P3_P4', 'P4_P5'];
      await Promise.all(transitions.map(t =>
        updateConfig.mutateAsync({
          transition: t,
          freeze_months: parseInt(freeze) || 6,
          flux_window_months: parseInt(fluxWindow) || 3,
          expenses_window_months: parseInt(expWindow) || 6,
          exceptional_drop_threshold_pct: parseFloat(dropThreshold) || 50,
        } as any)
      ));
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.sectionContent}>
      {[
        { label: 'Durée de gel du profil initial (mois)', value: freeze, setter: setFreeze },
        { label: 'Fenêtre de calcul des flux (mois)', value: fluxWindow, setter: setFluxWindow },
        { label: 'Fenêtre de calcul des dépenses moy. (mois)', value: expWindow, setter: setExpWindow },
        { label: 'Seuil de chute de revenus (%)', value: dropThreshold, setter: setDropThreshold },
      ].map(({ label, value, setter }) => (
        <View key={label} style={styles.globalRow}>
          <Text style={styles.globalLabel}>{label}</Text>
          <TextInput
            style={styles.globalInput}
            value={value}
            onChangeText={setter}
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color={COLORS.bg} size="small" />
          : <Text style={styles.saveBtnText}>Appliquer à toutes les transitions</Text>}
      </TouchableOpacity>

      {/* ── Seuils d'épargne + libellés (vue d'ensemble Comptes) ── */}
      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Seuils d'épargne (en €, base — convertis dans la devise de réf.)</Text>
      {[
        { field: 'min',     label: `Seuil « ${sv.label_critical || 'Critique'} » si épargne <` },
        { field: 'optimal', label: `Seuil « ${sv.label_low || 'À renforcer'} » si épargne <` },
        { field: 'comfort', label: `Seuil « ${sv.label_healthy || 'Saine'} » si épargne <` },
      ].map(({ field, label }) => (
        <View key={field} style={styles.globalRow}>
          <Text style={styles.globalLabel}>{label}</Text>
          <TextInput
            style={styles.globalInput}
            value={sv[field] ?? ''}
            onChangeText={(v) => setSv((p) => ({ ...p, [field]: v }))}
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}
      <Text style={styles.matrixInfo}>Au-delà du seuil le plus haut : « {sv.label_comfort || 'Confortable'} ».</Text>

      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Libellés des paliers</Text>
      {[
        { field: 'label_critical', label: 'Palier 1 (le plus bas)' },
        { field: 'label_low',      label: 'Palier 2' },
        { field: 'label_healthy',  label: 'Palier 3' },
        { field: 'label_comfort',  label: 'Palier 4 (le plus haut)' },
      ].map(({ field, label }) => (
        <View key={field} style={styles.globalRow}>
          <Text style={styles.globalLabel}>{label}</Text>
          <TextInput
            style={[styles.globalInput, { width: 130, textAlign: 'left' }]}
            value={sv[field] ?? ''}
            onChangeText={(v) => setSv((p) => ({ ...p, [field]: v }))}
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.saveBtn, saveSavings.isPending && { opacity: 0.6 }]}
        onPress={handleSaveSavings}
        disabled={saveSavings.isPending}
      >
        {saveSavings.isPending
          ? <ActivityIndicator color={COLORS.bg} size="small" />
          : <Text style={styles.saveBtnText}>Enregistrer les seuils d'épargne</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Écran principal ─────────────────────────────────────────────

export default function FinancialProfilesAdmin() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('simulate');

  if (!user) return null;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>

        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Profils financiers</Text>
        <Text style={styles.subtitle}>Configuration des profils P1-P5, seuils et messages.</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'simulate' && <SimulationSection userId={user.id} />}
          {activeTab === 'messages' && <MessagesSection userId={user.id} />}
          {activeTab === 'matrix'   && <MatrixSection userId={user.id} />}
          {activeTab === 'global'   && <GlobalSection userId={user.id} />}
        </KeyboardAwareScrollView>

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
  subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: c.bg },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  sectionContent: { gap: 12 },

  // Messages
  msgCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dirBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  dirBadgeText: { fontSize: 11, fontWeight: '700' },
  msgTransition: { flex: 1, fontSize: 13, fontWeight: '600', color: c.text },
  msgPreview: { gap: 4 },
  msgTitle: { fontSize: 13, fontWeight: '600', color: c.text, lineHeight: 18 },
  msgBody: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },

  // Matrice
  matrixInfo: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  matrixCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  matrixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matrixLabel: { fontSize: 13, fontWeight: '600', color: c.text, flex: 1 },
  matrixSummary: { gap: 4 },
  matrixSummaryText: { fontSize: 12, color: c.textSecondary },
  matrixRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  matrixRowLabel: { flex: 1, fontSize: 13, color: c.text },
  matrixInput: {
    width: 72, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: c.text, textAlign: 'center',
  },
  bufferRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bufferLabel: { fontSize: 12, color: c.textSecondary },
  bufferValue: { fontSize: 12, fontWeight: '700', color: c.emerald },

  // Paramètres globaux
  globalRow: {
    backgroundColor: c.card, borderRadius: 12, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  globalLabel: { flex: 1, fontSize: 13, color: c.text },
  globalInput: {
    width: 72, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: c.text, textAlign: 'center',
  },

  // Simulation
  simCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  simCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  simEmoji: { fontSize: 30 },
  simName: { fontSize: 16, fontWeight: '800' },
  simTier: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  simChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  simChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.bg,
  },
  simChipDisabled: { opacity: 0.5 },
  simChipEmoji: { fontSize: 15 },
  simChipText: { fontSize: 13, fontWeight: '700', color: c.text },
  simDirBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  simDirText: { fontSize: 12.5, fontWeight: '700' },
  simExcBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#f59e0b55', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#f59e0b12',
  },
  simExcText: { fontSize: 13, fontWeight: '600', color: c.text },
  simMaintainBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#60a5fa55', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#60a5fa12',
  },

  // Formulaire commun
  editForm: { gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  input: {
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: c.text, fontSize: 13,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: c.emerald, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  saveBtnText: { color: c.bg, fontWeight: '700', fontSize: 14 },
});
}
