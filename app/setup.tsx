import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './contexts/AuthContext';
import { useAccounts } from './hooks/useAccounts';
import { useUpdateProfile } from './hooks/useProfile';
import { useSaveQuestionnaire } from './hooks/useFinancialProfile';
import {
  Q1_OPTIONS, Q2_OPTIONS, Q3_OPTIONS, Q4_OPTIONS,
  Q5_OPTIONS, Q6_OPTIONS, Q7_OPTIONS,
  computeInitialProfile, detectIrregularIncome, PROFILE_INFO, PROFILE_ALLOCATIONS,
} from './lib/financialProfileEngine';
import type { QuestionnaireAnswers } from './lib/financialProfileEngine';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  selected: '#112f1c',
  selectedBorder: '#34d399',
};

const STEPS = ['Comptes', 'Revenus', 'Situation', 'Épargne', 'Objectif', 'Profil'];
const TOTAL_STEPS = STEPS.length;

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

export default function SetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [answers, setAnswers] = useState<QuestionnaireAnswers>({
    q1: '', q2: '', q3: '', q4: '', q5: '', q6: '', q7: '',
  });

  const totalAccounts = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);
  const hasChecking = accounts.some((acc) => acc.type === 'checking');
  const hasSaving = accounts.some((acc) => acc.type === 'savings');

  const assignedProfile = useMemo(() => {
    if (answers.q5 && answers.q4 && answers.q6) return computeInitialProfile(answers);
    return null;
  }, [answers]);

  const isIrregular = detectIrregularIncome(answers.q1, answers.q2);

  function setAnswer(key: keyof QuestionnaireAnswers, value: string) {
    setAnswers(prev => ({ ...prev, [key]: value }));
  }

  function canProceed(): boolean {
    switch (step) {
      case 1: return true;
      case 2: return !!answers.q1 && !!answers.q2;
      case 3: return !!answers.q3 && !!answers.q4;
      case 4: return !!answers.q5 && !!answers.q6;
      case 5: return !!answers.q7;
      case 6: return !!assignedProfile;
      default: return false;
    }
  }

  async function handleFinish() {
    if (!user?.id || !assignedProfile) return;
    setLoading(true);
    try {
      await saveQuestionnaire.mutateAsync({ answers });
      await updateProfile.mutateAsync({ initial_onboarding_completed: true });
      router.replace('/(tabs)/home');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de terminer la configuration.');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <Text style={styles.emptyText}>Connectez-vous pour configurer votre profil financier.</Text>
      </View>
    );
  }

  if (accountsLoading) {
    return (
      <View style={styles.root}>
        <ActivityIndicator size="large" color={COLORS.emerald} />
      </View>
    );
  }

  const profile = assignedProfile ? PROFILE_INFO[assignedProfile] : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom', 'top']}>

        {/* Barre de progression */}
        <View style={styles.stepsBar}>
          {STEPS.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <View key={label} style={[styles.stepItem, active && styles.stepItemActive]}>
                <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                  {done
                    ? <Ionicons name="checkmark" size={10} color={COLORS.bg} />
                    : <Text style={[styles.stepNum, active && styles.stepNumActive]}>{n}</Text>}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Étape 1 — Comptes ──────────────────────────── */}
          {step === 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Vos comptes</Text>
              <Text style={styles.cardText}>
                La base du pilotage, c'est votre solde courant, votre épargne et vos investissements.
              </Text>
              <View style={styles.accountRow}>
                <View style={styles.accountItem}>
                  <Text style={styles.accountLabel}>Comptes</Text>
                  <Text style={styles.accountValue}>{accounts.length}</Text>
                </View>
                <View style={styles.accountItem}>
                  <Text style={styles.accountLabel}>Total</Text>
                  <Text style={styles.accountValue}>
                    {totalAccounts.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                  </Text>
                </View>
              </View>
              <Text style={styles.cardText}>
                {hasChecking ? '✅ Compte courant' : '⚠️ Pas de compte courant'}
                {'  ·  '}
                {hasSaving ? '✅ Épargne' : '⚠️ Pas de compte épargne'}
              </Text>
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/comptes')}>
                <Ionicons name="wallet-outline" size={18} color={COLORS.bg} />
                <Text style={styles.actionBtnText}>Vérifier mes comptes</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Étape 2 — Revenus ─────────────────────────── */}
          {step === 2 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Vos revenus</Text>

              <Text style={styles.questionLabel}>Quel type de revenu possédez-vous ?</Text>
              <OptionList options={Q1_OPTIONS} selected={answers.q1} onSelect={v => setAnswer('q1', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>À quelle fréquence vos revenus principaux sont-ils versés ?</Text>
              <OptionList options={Q2_OPTIONS} selected={answers.q2} onSelect={v => setAnswer('q2', v)} />

              {isIrregular && (
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#60a5fa" />
                  <Text style={styles.infoText}>
                    Vos revenus irréguliers seront pris en compte via une moyenne glissante.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Étape 3 — Situation ────────────────────────── */}
          {step === 3 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre situation</Text>

              <Text style={styles.questionLabel}>Quel est le montant moyen de vos revenus nets par mois ?</Text>
              <OptionList options={Q3_OPTIONS} selected={answers.q3} onSelect={v => setAnswer('q3', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>Une fois vos factures et dépenses obligatoires payées, que reste-t-il ?</Text>
              <OptionList options={Q4_OPTIONS} selected={answers.q4} onSelect={v => setAnswer('q4', v)} />
            </View>
          )}

          {/* ── Étape 4 — Épargne ─────────────────────────── */}
          {step === 4 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre épargne</Text>

              <Text style={styles.questionLabel}>Si vos revenus s'arrêtaient demain, combien de temps pourriez-vous maintenir votre niveau de vie grâce à votre épargne disponible ?</Text>
              <OptionList options={Q5_OPTIONS} selected={answers.q5} onSelect={v => setAnswer('q5', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>Quel pourcentage approximatif de vos revenus mettez-vous de côté chaque mois ?</Text>
              <OptionList options={Q6_OPTIONS} selected={answers.q6} onSelect={v => setAnswer('q6', v)} />
            </View>
          )}

          {/* ── Étape 5 — Objectif ────────────────────────── */}
          {step === 5 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre objectif prioritaire</Text>
              <Text style={styles.questionLabel}>Quel est votre objectif prioritaire avec cette application ?</Text>
              <OptionList options={Q7_OPTIONS} selected={answers.q7} onSelect={v => setAnswer('q7', v)} />
            </View>
          )}

          {/* ── Étape 6 — Profil assigné ──────────────────── */}
          {step === 6 && profile && assignedProfile && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre profil financier</Text>
              <Text style={styles.cardText}>
                Basé sur vos réponses, voici votre profil de départ. Il évoluera automatiquement au fil du temps.
              </Text>

              <View style={[styles.profileCard, { borderColor: profile.color }]}>
                <Text style={styles.profileEmoji}>{profile.emoji}</Text>
                <Text style={[styles.profileName, { color: profile.color }]}>{profile.name}</Text>
                <Text style={styles.profileTier}>Palier : {profile.tier}</Text>
                <Text style={styles.profileDesc}>{profile.description}</Text>
              </View>

              <View style={styles.allocCard}>
                <Text style={styles.allocTitle}>Allocation recommandée</Text>
                {([
                  { label: 'Épargner',       key: 'save'   },
                  { label: 'Investir',        key: 'invest' },
                  { label: 'Se faire plaisir', key: 'enjoy' },
                  { label: 'Conserver',       key: 'keep'  },
                ] as { label: string; key: keyof typeof PROFILE_ALLOCATIONS[typeof assignedProfile] }[]).map(({ label, key }) => (
                  <View key={key} style={styles.allocRow}>
                    <Text style={styles.allocLabel}>{label}</Text>
                    <Text style={styles.allocValue}>{PROFILE_ALLOCATIONS[assignedProfile][key]} %</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.cardText}>
                Ce profil sera actif pendant 6 mois. Passé ce délai, l'application l'ajustera automatiquement selon vos données réelles.
              </Text>
            </View>
          )}

          {/* ── Navigation ────────────────────────────────── */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnSecondary]}
              onPress={() => setStep(prev => Math.max(1, prev - 1))}
              disabled={step === 1}
            >
              <Text style={[styles.footerBtnText, step === 1 && styles.footerBtnTextDisabled]}>
                Précédent
              </Text>
            </TouchableOpacity>

            {step < TOTAL_STEPS ? (
              <TouchableOpacity
                style={[styles.footerBtn, !canProceed() && styles.footerBtnDisabled]}
                onPress={() => {
                  if (!canProceed()) {
                    Alert.alert('Réponse requise', 'Veuillez répondre à toutes les questions avant de continuer.');
                    return;
                  }
                  setStep(prev => prev + 1);
                }}
              >
                <Text style={styles.footerBtnText}>Suivant</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.footerBtn, (loading || !assignedProfile) && styles.footerBtnDisabled]}
                onPress={handleFinish}
                disabled={loading || !assignedProfile}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.bg} />
                  : <Text style={styles.footerBtnText}>Démarrer</Text>}
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  safe: { flex: 1, width: '100%', paddingHorizontal: 20 },
  scroll: { flex: 1 },
  content: { paddingBottom: 100, gap: 16 },

  // Barre d'étapes
  stepsBar: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 12, gap: 4 },
  stepItem: { flex: 1, alignItems: 'center', gap: 4 },
  stepItemActive: {},
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: COLORS.emerald },
  stepDotDone: { backgroundColor: COLORS.emerald },
  stepNum: { fontSize: 10, fontWeight: '700', color: '#64748b' },
  stepNumActive: { color: COLORS.bg },
  stepLabel: { fontSize: 9, color: '#475569', fontWeight: '600', textAlign: 'center' },
  stepLabelActive: { color: COLORS.emerald },

  // Carte
  card: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 20, padding: 20, gap: 14,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  cardText: { color: '#cbd5e1', lineHeight: 20, fontSize: 14 },

  // Question
  questionLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: -6 },
  optionList: { gap: 8 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155',
    borderRadius: 12, padding: 14,
  },
  optionBtnActive: { borderColor: COLORS.emerald, backgroundColor: COLORS.selected },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    borderColor: '#475569', alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  radioActive: { borderColor: COLORS.emerald },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.emerald },
  optionText: { flex: 1, color: '#94a3b8', fontSize: 14, lineHeight: 20 },
  optionTextActive: { color: COLORS.text },

  divider: { height: 1, backgroundColor: COLORS.cardBorder },

  // Info box revenus irréguliers
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 12,
  },
  infoText: { flex: 1, color: '#93c5fd', fontSize: 12, lineHeight: 18 },

  // Profil assigné
  profileCard: {
    borderWidth: 2, borderRadius: 16, padding: 20,
    alignItems: 'center', gap: 8, backgroundColor: '#0c1a2e',
  },
  profileEmoji: { fontSize: 40 },
  profileName: { fontSize: 20, fontWeight: '800' },
  profileTier: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  profileDesc: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, textAlign: 'center' },

  // Allocation
  allocCard: {
    backgroundColor: '#020617', borderRadius: 14, padding: 16, gap: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  allocTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  allocRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allocLabel: { color: COLORS.text, fontSize: 14 },
  allocValue: { color: COLORS.emerald, fontWeight: '700', fontSize: 15 },

  // Comptes
  accountRow: { flexDirection: 'row', gap: 12 },
  accountItem: { flex: 1, backgroundColor: '#111827', borderRadius: 14, padding: 14 },
  accountLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  accountValue: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  actionBtn: {
    paddingVertical: 14, borderRadius: 14, backgroundColor: COLORS.emerald,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  actionBtnText: { color: COLORS.bg, fontWeight: '700' },

  // Footer
  footer: { flexDirection: 'row', gap: 12, marginTop: 4 },
  footerBtn: { flex: 1, backgroundColor: COLORS.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  footerBtnSecondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder },
  footerBtnDisabled: { opacity: 0.5 },
  footerBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 15 },
  footerBtnTextDisabled: { color: '#475569' },

  emptyText: { color: COLORS.text, fontSize: 16, textAlign: 'center', marginHorizontal: 24 },
});
