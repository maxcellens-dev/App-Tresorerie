import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  RECO_COLORS,
  RECO_TYPE_LABELS,
  TIER_LABELS,
  TIER_COLORS,
} from '../../lib/recommendationEngine';
import type { RecoType, SavingsTier } from '../../lib/recommendationEngine';
import { useRecommendationTiers, useUpdateRecommendationTiers } from '../../hooks/useRecommendationTiers';
import type { TierAllocations } from '../../hooks/useRecommendationTiers';
import { useRecoThresholds, useUpdateRecoThresholds } from '../../hooks/useRecoThresholds';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useNavBack } from '../../hooks/useNavBack';


const RECO_ICONS: Record<RecoType, string> = {
  save: 'shield-outline',
  invest: 'trending-up-outline',
  enjoy: 'sparkles-outline',
  keep: 'hourglass-outline',
};

const RECO_DESC: Record<RecoType, string> = {
  save: 'Transférer vers l\'épargne de sécurité.',
  invest: 'Alimenter un objectif d\'investissement.',
  enjoy: 'Budget dépenses variables et loisirs.',
  keep: 'Conserver sur le compte courant.',
};

const TIERS: SavingsTier[] = ['critical', 'below_optimal', 'healthy', 'p4_dynamic', 'comfortable'];
const TIER_CONDITIONS: Record<SavingsTier, string> = {
  critical:      'Profil P1 — Premiers repères',
  below_optimal: 'Profil P2 — Réserve à construire',
  healthy:       'Profil P3 — Stabilité à améliorer',
  p4_dynamic:    'Profil P4 — Bonne dynamique',
  comfortable:   'Profil P5 — Patrimoine en développement',
};

const TYPES: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];

const MODIFIERS = [
  { icon: 'analytics-outline', name: 'Tendance variables', desc: 'Si > 120 % → moins de plaisir, plus de réserve. Si < 80 % → un peu plus de plaisir.' },
  { icon: 'wallet-outline', name: 'Santé courant', desc: 'Si solde < 2× engagements mensuels → +10 pp sur Conserver.' },
  { icon: 'swap-horizontal-outline', name: 'Ratio invest/épargne', desc: 'Si investi < 15 % de l\'épargne → +8 pp sur Investir.' },
];

export default function RecommendationsAdmin() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { data: dbTiers, isLoading } = useRecommendationTiers();
  const updateTiers = useUpdateRecommendationTiers();
  const { user } = useAuth();
  const { data: thresholds } = useRecoThresholds();
  const updateThresholds = useUpdateRecoThresholds(user?.id);

  // Local editable state: string values for inputs
  const [draft, setDraft] = useState<Record<SavingsTier, Record<RecoType, string>> | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Seuils de reste min pour afficher chaque reco (§9)
  const [seuils, setSeuils] = useState<{ epargne: string; invest: string; plaisir: string; conserver: string }>({ epargne: '', invest: '', plaisir: '', conserver: '' });
  useEffect(() => {
    if (thresholds) {
      setSeuils({
        epargne: String(thresholds.seuil_reco_epargne),
        invest: String(thresholds.seuil_reco_invest),
        plaisir: String(thresholds.seuil_reco_plaisir),
        conserver: String(thresholds.seuil_reco_conserver ?? 50),
      });
    }
  }, [thresholds]);

  async function saveSeuils() {
    const e = parseFloat(seuils.epargne.replace(',', '.'));
    const i = parseFloat(seuils.invest.replace(',', '.'));
    const p = parseFloat(seuils.plaisir.replace(',', '.'));
    const c = parseFloat(seuils.conserver.replace(',', '.'));
    if ([e, i, p, c].some((v) => Number.isNaN(v) || v < 0)) {
      Alert.alert('Valeur invalide', 'Saisissez des montants positifs.');
      return;
    }
    try {
      await updateThresholds.mutateAsync({ seuil_reco_epargne: e, seuil_reco_invest: i, seuil_reco_plaisir: p, seuil_reco_conserver: c });
      Alert.alert('Enregistré', 'Les seuils ont été mis à jour.');
    } catch (err: unknown) {
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de sauvegarder.');
    }
  }

  useEffect(() => {
    if (dbTiers && !draft) {
      setDraft(toStringDraft(dbTiers));
    }
  }, [dbTiers]);

  function toStringDraft(alloc: TierAllocations): Record<SavingsTier, Record<RecoType, string>> {
    const result = {} as Record<SavingsTier, Record<RecoType, string>>;
    for (const tier of TIERS) {
      result[tier] = {} as Record<RecoType, string>;
      for (const type of TYPES) {
        result[tier][type] = String(alloc[tier][type]);
      }
    }
    return result;
  }

  function getTierSum(tier: SavingsTier): number {
    if (!draft) return 0;
    return TYPES.reduce((s, t) => s + (parseInt(draft[tier][t], 10) || 0), 0);
  }

  function handleChange(tier: SavingsTier, type: RecoType, value: string) {
    if (!draft) return;
    setDraft(prev => ({
      ...prev!,
      [tier]: { ...prev![tier], [type]: value.replace(/[^0-9]/g, '') },
    }));
  }

  async function handleSave() {
    if (!draft) return;
    // Validate each tier sums to 100
    for (const tier of TIERS) {
      const sum = getTierSum(tier);
      if (sum !== 100) {
        Alert.alert('Erreur', `Le palier "${TIER_LABELS[tier]}" totalise ${sum} % au lieu de 100 %.`);
        return;
      }
    }
    // Build typed allocations
    const alloc = {} as TierAllocations;
    for (const tier of TIERS) {
      alloc[tier] = {} as Record<RecoType, number>;
      for (const type of TYPES) {
        alloc[tier][type] = parseInt(draft[tier][type], 10) || 0;
      }
    }
    try {
      await updateTiers.mutateAsync(alloc);
      setEditMode(false);
      Alert.alert('Enregistré', 'Les paliers ont été mis à jour. Ils s\'appliquent dès la prochaine ouverture du Pilotage.');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    }
  }

  function handleCancel() {
    if (dbTiers) setDraft(toStringDraft(dbTiers));
    setEditMode(false);
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            <Text style={styles.backLabel}>Retour</Text>
          </TouchableOpacity>
          {!editMode ? (
            <TouchableOpacity style={styles.editBtn} onPress={() => setEditMode(true)}>
              <Ionicons name="pencil-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.editBtnLabel}>Modifier</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, updateTiers.isPending && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={updateTiers.isPending}
              >
                {updateTiers.isPending
                  ? <ActivityIndicator size="small" color={COLORS.bg} />
                  : <Text style={styles.saveBtnLabel}>Enregistrer</Text>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Recommandations</Text>
          <Text style={styles.subtitle}>
            Le moteur propose 2 à 4 actions dont la somme fait 100 % du « À dépenser ».
            {editMode ? ' Chaque palier doit totaliser exactement 100 %.' : ''}
          </Text>

          {/* ── Types ── */}
          <Text style={styles.sectionTitle}>Types de recommandation</Text>
          {TYPES.map(type => (
            <View key={type} style={[styles.typeCard, { borderLeftColor: RECO_COLORS[type] }]}>
              <View style={styles.typeHeader}>
                <Ionicons name={RECO_ICONS[type] as any} size={18} color={RECO_COLORS[type]} />
                <Text style={[styles.typeTitle, { color: RECO_COLORS[type] }]}>{RECO_TYPE_LABELS[type]}</Text>
              </View>
              <Text style={styles.typeDesc}>{RECO_DESC[type]}</Text>
            </View>
          ))}

          {/* ── Paliers ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Paliers d'allocation</Text>
          {isLoading || !draft ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 16 }} />
          ) : (
            TIERS.map(tier => {
              const sum = getTierSum(tier);
              const isInvalid = editMode && sum !== 100;
              return (
                <View key={tier} style={[styles.tierCard, isInvalid && styles.tierCardInvalid]}>
                  <View style={styles.tierHeader}>
                    <View style={[styles.tierDot, { backgroundColor: TIER_COLORS[tier] }]} />
                    <Text style={[styles.tierName, { color: TIER_COLORS[tier] }]}>{TIER_LABELS[tier]}</Text>
                    {editMode && (
                      <Text style={[styles.tierSum, { color: isInvalid ? COLORS.danger : COLORS.emerald }]}>
                        {sum} %
                      </Text>
                    )}
                  </View>
                  <Text style={styles.tierCondition}>{TIER_CONDITIONS[tier]}</Text>

                  {editMode ? (
                    <View style={styles.inputGrid}>
                      {TYPES.map(type => (
                        <View key={type} style={styles.inputItem}>
                          <View style={styles.inputLabelRow}>
                            <View style={[styles.allocDot, { backgroundColor: RECO_COLORS[type] }]} />
                            <Text style={styles.inputLabel}>{RECO_TYPE_LABELS[type]}</Text>
                          </View>
                          <View style={styles.inputWrapper}>
                            <TextInput
                              style={styles.input}
                              value={draft[tier][type]}
                              onChangeText={v => handleChange(tier, type, v)}
                              keyboardType="numeric"
                              maxLength={3}
                              selectTextOnFocus
                            />
                            <Text style={styles.inputSuffix}>%</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.allocRow}>
                      {TYPES.map(type => (
                        <View key={type} style={styles.allocItem}>
                          <View style={[styles.allocDot, { backgroundColor: RECO_COLORS[type] }]} />
                          <Text style={styles.allocText}>
                            {RECO_TYPE_LABELS[type]} {draft[tier][type]} %
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* ── Seuils d'affichage ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Seuils d'affichage</Text>
          <Text style={styles.typeDesc}>
            Une reco n'est affichée que si le « Budget libre à allouer » atteint son seuil.
          </Text>
          {([
            { key: 'epargne' as const, label: 'Épargne', color: RECO_COLORS.save },
            { key: 'invest' as const, label: 'Investissement', color: RECO_COLORS.invest },
            { key: 'plaisir' as const, label: 'Se faire plaisir', color: RECO_COLORS.enjoy },
            { key: 'conserver' as const, label: 'Conserver', color: RECO_COLORS.keep },
          ]).map((s) => (
            <View key={s.key} style={[styles.typeCard, { borderLeftColor: s.color }]}>
              <View style={styles.seuilRow}>
                <Text style={[styles.typeTitle, { color: s.color, flex: 1 }]}>{s.label}</Text>
                <View style={styles.seuilInputWrap}>
                  <TextInput
                    style={styles.seuilInput}
                    value={seuils[s.key]}
                    onChangeText={(t) => setSeuils((prev) => ({ ...prev, [s.key]: t.replace(/[^0-9.,]/g, '') }))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.seuilSuffix}>€</Text>
                </View>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.seuilSaveBtn, updateThresholds.isPending && { opacity: 0.6 }]}
            onPress={saveSeuils}
            disabled={updateThresholds.isPending}
          >
            <Text style={styles.seuilSaveLabel}>Enregistrer les seuils</Text>
          </TouchableOpacity>

          {/* ── Modificateurs ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Modificateurs contextuels</Text>
          <Text style={styles.modNote}>Ces ajustements s'appliquent après les paliers et ne sont pas éditables ici.</Text>
          {MODIFIERS.map(m => (
            <View key={m.name} style={styles.modCard}>
              <Ionicons name={m.icon as any} size={18} color={COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modName}>{m.name}</Text>
                <Text style={styles.modDesc}>{m.desc}</Text>
              </View>
            </View>
          ))}

          {/* ── Règles ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Règles</Text>
          <View style={styles.rulesCard}>
            <Text style={styles.ruleItem}>• Recommandations &lt; 5 % → masquées et redistribuées</Text>
            <Text style={styles.ruleItem}>• Total = toujours 100 % du « À dépenser »</Text>
            <Text style={styles.ruleItem}>• 2 à 4 recommandations affichées</Text>
            <Text style={styles.ruleItem}>• Les préférences utilisateur écrasent les paliers</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  seuilRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seuilInputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, minWidth: 90,
  },
  seuilInput: { flex: 1, color: c.text, fontSize: 15, fontWeight: '700', paddingVertical: 9 },
  seuilSuffix: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  seuilSaveBtn: { backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  seuilSaveLabel: { color: c.bg, fontWeight: '700', fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtnLabel: { fontSize: 14, fontWeight: '600', color: c.emerald },
  headerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder },
  cancelLabel: { fontSize: 14, color: c.textSecondary },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: c.emerald },
  saveBtnLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },

  typeCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  typeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  typeTitle: { fontSize: 14, fontWeight: '700' },
  typeDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  tierCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  tierCardInvalid: { borderColor: c.danger },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  tierName: { fontSize: 14, fontWeight: '700', flex: 1 },
  tierSum: { fontSize: 13, fontWeight: '700' },
  tierCondition: { fontSize: 12, color: c.textSecondary },
  allocRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allocItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocText: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },

  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  inputItem: { width: '46%' },
  inputLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  inputLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 10 },
  input: { flex: 1, color: c.text, fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  inputSuffix: { color: c.textSecondary, fontSize: 14 },

  modNote: { fontSize: 12, color: c.textSecondary, marginBottom: 10, fontStyle: 'italic' },
  modCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  modName: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 },
  modDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  rulesCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    gap: 6,
  },
  ruleItem: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
});
}
