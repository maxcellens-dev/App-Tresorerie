import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import {
  useFinancialProfile,
  useQuestionnaireAnswers,
  useSaveQuestionnaire,
} from '../../hooks/useFinancialProfile';
import {
  PROFILE_INFO, PROFILE_ALLOCATIONS,
  Q1_OPTIONS, Q2_OPTIONS, Q3_OPTIONS, Q4_OPTIONS,
  Q5_OPTIONS, Q6_OPTIONS, Q7_OPTIONS,
  computeInitialProfile, detectIrregularIncome,
} from '../../lib/financialProfileEngine';
import type { QuestionnaireAnswers } from '../../lib/financialProfileEngine';
import type { FinancialProfileId } from '../../types/database';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  selected: '#112f1c',
};

const QUESTIONS = [
  { key: 'q1' as const, label: 'Quel type de revenu possédez-vous ?', options: Q1_OPTIONS },
  { key: 'q2' as const, label: 'À quelle fréquence vos revenus principaux sont-ils versés ?', options: Q2_OPTIONS },
  { key: 'q3' as const, label: 'Quel est le montant moyen de vos revenus nets par mois ?', options: Q3_OPTIONS },
  { key: 'q4' as const, label: 'Une fois vos factures et dépenses obligatoires payées, que reste-t-il ?', options: Q4_OPTIONS },
  { key: 'q5' as const, label: 'Si vos revenus s\'arrêtaient demain, combien de temps pourriez-vous maintenir votre niveau de vie grâce à votre épargne disponible ?', options: Q5_OPTIONS },
  { key: 'q6' as const, label: 'Quel pourcentage approximatif de vos revenus mettez-vous de côté chaque mois ?', options: Q6_OPTIONS },
  { key: 'q7' as const, label: 'Quel est votre objectif prioritaire avec cette application ?', options: Q7_OPTIONS },
];

function OptionList({
  options,
  selected,
  onSelect,
}: {
  options: readonly string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={styles.optionList}>
      {options.map((opt) => {
        const active = selected === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.optionBtn, active && styles.optionBtnActive]}
            onPress={() => onSelect(opt)}
            activeOpacity={0.7}
          >
            <View style={[styles.radio, active && styles.radioActive]}>
              {active && <View style={styles.radioDot} />}
            </View>
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function ProfilFinancierScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: fp, isLoading: fpLoading } = useFinancialProfile(user?.id);
  const { data: savedAnswers, isLoading: answersLoading } = useQuestionnaireAnswers(user?.id);
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);

  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({
    q1: '', q2: '', q3: '', q4: '', q5: '', q6: '', q7: '',
  });

  function startEditing() {
    if (savedAnswers) {
      setAnswers({
        q1: savedAnswers.q1 ?? '',
        q2: savedAnswers.q2 ?? '',
        q3: savedAnswers.q3 ?? '',
        q4: savedAnswers.q4 ?? '',
        q5: savedAnswers.q5 ?? '',
        q6: savedAnswers.q6 ?? '',
        q7: savedAnswers.q7 ?? '',
      });
    }
    setEditing(true);
  }

  async function handleSave() {
    const allAnswered = answers.q1 && answers.q2 && answers.q3 && answers.q4 && answers.q5 && answers.q6 && answers.q7;
    if (!allAnswered) {
      Alert.alert('Réponses incomplètes', 'Veuillez répondre à toutes les questions.');
      return;
    }
    try {
      await saveQuestionnaire.mutateAsync({ answers, isUpdate: true });
      setEditing(false);
      Alert.alert('Profil mis à jour', 'Vos réponses ont été enregistrées. Votre profil a été recalculé.');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  if (fpLoading || answersLoading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.emerald} />
      </View>
    );
  }

  const profileId = fp?.profile_id as FinancialProfileId | undefined;
  const profile = profileId ? PROFILE_INFO[profileId] : null;
  const alloc = profileId ? PROFILE_ALLOCATIONS[profileId] : null;

  // Calcul de la date de déblocage auto
  const autoUnlockDate = fp?.auto_unlock_at ? new Date(fp.auto_unlock_at) : null;
  const isLocked = autoUnlockDate ? new Date() < autoUnlockDate : false;
  const monthsUntilAuto = autoUnlockDate
    ? Math.max(0, Math.ceil((autoUnlockDate.getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000)))
    : 0;

  const isIrregular = fp?.is_irregular_income ?? false;
  const assignedAt = fp?.assigned_at ? new Date(fp.assigned_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const previewProfile = editing && answers.q5 && answers.q4 && answers.q6
    ? computeInitialProfile(answers)
    : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Profil actuel ─────────────────────────────── */}
          {profile && profileId && alloc && !editing && (
            <>
              <View style={[styles.profileHeader, { borderColor: profile.color }]}>
                <Text style={styles.profileEmoji}>{profile.emoji}</Text>
                <View style={styles.profileHeaderInfo}>
                  <Text style={[styles.profileName, { color: profile.color }]}>{profile.name}</Text>
                  <Text style={styles.profileTier}>{profile.tier}</Text>
                  <Text style={styles.profileDesc}>{profile.description}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Source</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {fp?.profile_source === 'automatic' ? '⚡ Calcul automatique' : '📝 Questionnaire'}
                    </Text>
                  </View>
                </View>
                {assignedAt && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Attribué le</Text>
                    <Text style={styles.metaValue}>{assignedAt}</Text>
                  </View>
                )}
                {isLocked && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Évolution auto</Text>
                    <View style={[styles.badge, { backgroundColor: '#1e293b' }]}>
                      <Text style={styles.badgeText}>Dans {monthsUntilAuto} mois</Text>
                    </View>
                  </View>
                )}
                {isIrregular && (
                  <View style={styles.infoBox}>
                    <Ionicons name="information-circle-outline" size={14} color="#60a5fa" />
                    <Text style={styles.infoText}>
                      Revenus irréguliers détectés — calculs sur moyenne glissante.
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Allocation recommandée</Text>
                {([
                  { label: 'Épargner',        key: 'save'   as const, color: '#34d399' },
                  { label: 'Investir',         key: 'invest' as const, color: '#a78bfa' },
                  { label: 'Se faire plaisir', key: 'enjoy'  as const, color: '#f59e0b' },
                  { label: 'Conserver',        key: 'keep'   as const, color: '#60a5fa' },
                ]).map(({ label, key, color }) => {
                  const pct = alloc[key];
                  return (
                    <View key={key} style={styles.allocRow}>
                      <Text style={styles.allocLabel}>{label}</Text>
                      <View style={styles.allocBarContainer}>
                        <View style={[styles.allocBar, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={[styles.allocPct, { color }]}>{pct} %</Text>
                    </View>
                  );
                })}
              </View>

              <TouchableOpacity style={styles.editBtn} onPress={startEditing}>
                <Ionicons name="create-outline" size={18} color={COLORS.bg} />
                <Text style={styles.editBtnText}>Mettre à jour mes réponses</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Mode édition — questionnaire ──────────────── */}
          {editing && (
            <>
              <View style={styles.editHeader}>
                <Text style={styles.editTitle}>Modifier mes réponses</Text>
                <Text style={styles.editSub}>
                  Recalcule votre profil initial. Aucune notification ne sera envoyée.
                </Text>
              </View>

              {previewProfile && (
                <View style={[styles.previewCard, { borderColor: PROFILE_INFO[previewProfile].color }]}>
                  <Text style={styles.previewLabel}>Profil prévu</Text>
                  <Text style={styles.previewProfile}>
                    {PROFILE_INFO[previewProfile].emoji} {PROFILE_INFO[previewProfile].name}
                  </Text>
                </View>
              )}

              {QUESTIONS.map((q, i) => (
                <View key={q.key} style={styles.card}>
                  <Text style={styles.questionNum}>Question {i + 1}</Text>
                  <Text style={styles.questionLabel}>{q.label}</Text>
                  <OptionList
                    options={q.options}
                    selected={answers[q.key]}
                    onSelect={v => setAnswers(prev => ({ ...prev, [q.key]: v }))}
                  />
                </View>
              ))}

              <View style={styles.editFooter}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setEditing(false)}
                >
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, saveQuestionnaire.isPending && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={saveQuestionnaire.isPending}
                >
                  {saveQuestionnaire.isPending
                    ? <ActivityIndicator color={COLORS.bg} />
                    : <Text style={styles.saveBtnText}>Enregistrer</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Aucun profil ──────────────────────────────── */}
          {!profile && !editing && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Aucun profil financier attribué.</Text>
              <TouchableOpacity style={styles.editBtn} onPress={startEditing}>
                <Text style={styles.editBtnText}>Répondre au questionnaire</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 20 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  backLabel: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  scroll: { flex: 1 },
  content: { paddingBottom: 100, gap: 16 },

  // Profil header
  profileHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 16,
    borderWidth: 2, borderRadius: 20, padding: 20, backgroundColor: '#0c1a2e',
  },
  profileEmoji: { fontSize: 40 },
  profileHeaderInfo: { flex: 1, gap: 4 },
  profileName: { fontSize: 18, fontWeight: '800' },
  profileTier: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  profileDesc: { fontSize: 13, color: '#cbd5e1', lineHeight: 18, marginTop: 4 },

  // Meta card
  card: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 16, padding: 16, gap: 12,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: 13, color: COLORS.textSecondary },
  metaValue: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  badge: { backgroundColor: '#1e3a2f', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, color: COLORS.emerald, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 10,
  },
  infoText: { flex: 1, color: '#93c5fd', fontSize: 12, lineHeight: 16 },

  // Allocation
  sectionLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  allocLabel: { width: 110, fontSize: 13, color: COLORS.text },
  allocBarContainer: { flex: 1, height: 6, backgroundColor: '#1e293b', borderRadius: 3 },
  allocBar: { height: 6, borderRadius: 3 },
  allocPct: { width: 40, fontSize: 13, fontWeight: '700', textAlign: 'right' },

  // Bouton edit
  editBtn: {
    backgroundColor: COLORS.emerald, borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  editBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 15 },

  // Mode édition
  editHeader: { gap: 6 },
  editTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  editSub: { fontSize: 13, color: COLORS.textSecondary },
  previewCard: {
    borderWidth: 2, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0c1a2e',
  },
  previewLabel: { fontSize: 12, color: COLORS.textSecondary },
  previewProfile: { fontSize: 15, fontWeight: '700', color: COLORS.text },

  questionNum: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600', textTransform: 'uppercase' },
  questionLabel: { fontSize: 14, fontWeight: '600', color: COLORS.text },

  optionList: { gap: 8 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155',
    borderRadius: 12, padding: 12,
  },
  optionBtnActive: { borderColor: COLORS.emerald, backgroundColor: COLORS.selected },
  radio: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2,
    borderColor: '#475569', alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  radioActive: { borderColor: COLORS.emerald },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.emerald },
  optionText: { flex: 1, color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  optionTextActive: { color: COLORS.text },

  editFooter: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: COLORS.text, fontWeight: '600' },
  saveBtn: {
    flex: 2, backgroundColor: COLORS.emerald,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: COLORS.card, borderRadius: 16, padding: 24,
    alignItems: 'center', gap: 16,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
});
