import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
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
import { useAppColors } from '../../hooks/useAppColors';


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
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
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
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: fp, isLoading: fpLoading } = useFinancialProfile(user?.id);
  const { data: savedAnswers, isLoading: answersLoading } = useQuestionnaireAnswers(user?.id);
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);

  const queryClient = useQueryClient();
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
    const qLabels: Record<keyof QuestionnaireAnswers, string> = {
      q1: 'Q1 — Type de revenu',
      q2: 'Q2 — Fréquence de versement',
      q3: 'Q3 — Revenus nets',
      q4: 'Q4 — Reste à vivre',
      q5: 'Q5 — Réserve de sécurité',
      q6: 'Q6 — Taux d\'épargne',
      q7: 'Q7 — Objectif prioritaire',
    };
    const missing = (Object.keys(qLabels) as (keyof QuestionnaireAnswers)[])
      .filter(k => !answers[k])
      .map(k => qLabels[k]);

    if (missing.length > 0) {
      Alert.alert(
        'Réponses manquantes',
        `Veuillez répondre à :\n• ${missing.join('\n• ')}`,
      );
      return;
    }

    try {
      await saveQuestionnaire.mutateAsync({ answers, isUpdate: true });
    } catch (e: unknown) {
      const msg =
        (e as any)?.message ??
        (e as any)?.details ??
        (e as any)?.hint ??
        'Erreur inconnue. Vérifiez votre connexion.';
      Alert.alert('Erreur lors de l\'enregistrement', String(msg));
      return;
    }

    // Forcer le rafraîchissement du cache puis quitter le mode édition
    await queryClient.invalidateQueries({ queryKey: ['financial_profile', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['questionnaire_answers', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
    setEditing(false);
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
                    <View style={[styles.badge, { backgroundColor: COLORS.cardBorder }]}>
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

              {/* Récapitulatif des réponses au questionnaire */}
              {savedAnswers && (
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>Vos réponses</Text>
                  {QUESTIONS.map((q, i) => {
                    const answer = (savedAnswers as any)[q.key] as string | undefined;
                    return (
                      <View key={q.key} style={styles.answerRow}>
                        <Text style={styles.answerQuestion}>{i + 1}. {q.label}</Text>
                        <Text style={styles.answerValue}>{answer || '—'}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 20 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  backLabel: { fontSize: 15, color: c.text, fontWeight: '500' },
  scroll: { flex: 1 },
  content: { paddingBottom: 100, gap: 16 },

  // Profil header
  profileHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 16,
    borderWidth: 2, borderRadius: 20, padding: 20, backgroundColor: c.card,
  },
  profileEmoji: { fontSize: 40 },
  profileHeaderInfo: { flex: 1, gap: 4 },
  profileName: { fontSize: 18, fontWeight: '800' },
  profileTier: { fontSize: 12, color: c.textSecondary, fontWeight: '500' },
  profileDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginTop: 4 },

  // Meta card
  card: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 16, padding: 16, gap: 12,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: 13, color: c.textSecondary },
  metaValue: { fontSize: 13, color: c.text, fontWeight: '500' },
  badge: { backgroundColor: c.emerald + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, color: c.emerald, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: c.cardBorder, borderRadius: 10, padding: 10,
  },
  infoText: { flex: 1, color: '#93c5fd', fontSize: 12, lineHeight: 16 },

  // Récapitulatif des réponses
  answerRow: {
    gap: 3, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.cardBorder,
  },
  answerQuestion: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },
  answerValue: { fontSize: 14, color: c.text, fontWeight: '600', lineHeight: 19 },

  // Allocation
  sectionLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  allocLabel: { width: 110, fontSize: 13, color: c.text },
  allocBarContainer: { flex: 1, height: 6, backgroundColor: c.cardBorder, borderRadius: 3 },
  allocBar: { height: 6, borderRadius: 3 },
  allocPct: { width: 40, fontSize: 13, fontWeight: '700', textAlign: 'right' },

  // Bouton edit
  editBtn: {
    backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  editBtnText: { color: c.bg, fontWeight: '700', fontSize: 15 },

  // Mode édition
  editHeader: { gap: 6 },
  editTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  editSub: { fontSize: 13, color: c.textSecondary },
  previewCard: {
    borderWidth: 2, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.card,
  },
  previewLabel: { fontSize: 12, color: c.textSecondary },
  previewProfile: { fontSize: 15, fontWeight: '700', color: c.text },

  questionNum: { fontSize: 11, color: c.textSecondary, fontWeight: '600', textTransform: 'uppercase' },
  questionLabel: { fontSize: 14, fontWeight: '600', color: c.text },

  optionList: { gap: 8 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 12, padding: 12,
  },
  optionBtnActive: { borderColor: c.emerald, backgroundColor: c.selected },
  radio: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2,
    borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  radioActive: { borderColor: c.emerald },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.emerald },
  optionText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  optionTextActive: { color: c.text },

  editFooter: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: c.text, fontWeight: '600' },
  saveBtn: {
    flex: 2, backgroundColor: c.emerald,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: c.bg, fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 24,
    alignItems: 'center', gap: 16,
  },
  emptyText: { color: c.textSecondary, fontSize: 14 },
});
}
