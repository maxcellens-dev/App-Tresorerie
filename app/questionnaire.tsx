/**
 * Questionnaire standalone — affiché aux utilisateurs existants
 * qui n'ont pas encore répondu au questionnaire de profil financier.
 * Reprend le même moteur que setup.tsx (étapes 2-6).
 */
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './contexts/AuthContext';
import { useSaveQuestionnaire } from './hooks/useFinancialProfile';
import {
  Q1_OPTIONS, Q2_OPTIONS, Q3_OPTIONS, Q4_OPTIONS,
  Q5_OPTIONS, Q6_OPTIONS, Q7_OPTIONS,
  computeInitialProfile, detectIrregularIncome,
  PROFILE_INFO, PROFILE_ALLOCATIONS,
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
};

const STEPS = ['Revenus', 'Situation', 'Épargne', 'Objectif', 'Profil'];
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

export default function QuestionnaireScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({
    q1: '', q2: '', q3: '', q4: '', q5: '', q6: '', q7: '',
  });

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
      case 1: return !!answers.q1 && !!answers.q2;
      case 2: return !!answers.q3 && !!answers.q4;
      case 3: return !!answers.q5 && !!answers.q6;
      case 4: return !!answers.q7;
      case 5: return !!assignedProfile;
      default: return false;
    }
  }

  async function handleFinish() {
    if (!user?.id || !assignedProfile) return;
    setLoading(true);
    try {
      await saveQuestionnaire.mutateAsync({ answers });
      router.replace('/(tabs)/home');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  const profile = assignedProfile ? PROFILE_INFO[assignedProfile] : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Votre profil financier</Text>
          <Text style={styles.headerSub}>
            Quelques questions pour personnaliser vos recommandations.
          </Text>
        </View>

        {/* Barre de progression */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{step} / {TOTAL_STEPS} — {STEPS[step - 1]}</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Étape 1 — Revenus */}
          {step === 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Vos revenus</Text>

              <Text style={styles.questionLabel}>Type de revenu</Text>
              <OptionList options={Q1_OPTIONS} selected={answers.q1} onSelect={v => setAnswer('q1', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>Fréquence de versement</Text>
              <OptionList options={Q2_OPTIONS} selected={answers.q2} onSelect={v => setAnswer('q2', v)} />

              {isIrregular && (
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#60a5fa" />
                  <Text style={styles.infoText}>
                    Vos revenus irréguliers seront pris en compte via une moyenne glissante pour éviter les faux signaux.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Étape 2 — Situation */}
          {step === 2 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre situation</Text>

              <Text style={styles.questionLabel}>Revenus nets moyens par mois</Text>
              <OptionList options={Q3_OPTIONS} selected={answers.q3} onSelect={v => setAnswer('q3', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>Reste à vivre après charges</Text>
              <OptionList options={Q4_OPTIONS} selected={answers.q4} onSelect={v => setAnswer('q4', v)} />
            </View>
          )}

          {/* Étape 3 — Épargne */}
          {step === 3 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre épargne</Text>

              <Text style={styles.questionLabel}>Réserve de sécurité disponible</Text>
              <OptionList options={Q5_OPTIONS} selected={answers.q5} onSelect={v => setAnswer('q5', v)} />

              <View style={styles.divider} />

              <Text style={styles.questionLabel}>Taux d'épargne mensuel actuel</Text>
              <OptionList options={Q6_OPTIONS} selected={answers.q6} onSelect={v => setAnswer('q6', v)} />
            </View>
          )}

          {/* Étape 4 — Objectif */}
          {step === 4 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre objectif prioritaire</Text>
              <Text style={styles.cardText}>
                Personnalise vos recommandations et l'ordre d'affichage des actions.
              </Text>
              <OptionList options={Q7_OPTIONS} selected={answers.q7} onSelect={v => setAnswer('q7', v)} />
            </View>
          )}

          {/* Étape 5 — Profil assigné */}
          {step === 5 && profile && assignedProfile && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Votre profil financier</Text>
              <Text style={styles.cardText}>
                Ce profil est basé sur vos réponses. Il évoluera automatiquement à partir du 7ème mois.
              </Text>

              <View style={[styles.profileCard, { borderColor: profile.color }]}>
                <Text style={styles.profileEmoji}>{profile.emoji}</Text>
                <Text style={[styles.profileName, { color: profile.color }]}>{profile.name}</Text>
                <Text style={styles.profileTier}>Palier : {profile.tier}</Text>
                <Text style={styles.profileDesc}>{profile.description}</Text>
              </View>

              <View style={styles.allocCard}>
                <Text style={styles.allocTitle}>Allocation du surplus mensuel</Text>
                {([
                  { label: 'Épargner',        key: 'save'   },
                  { label: 'Investir',         key: 'invest' },
                  { label: 'Se faire plaisir', key: 'enjoy'  },
                  { label: 'Conserver',        key: 'keep'   },
                ] as { label: string; key: keyof typeof PROFILE_ALLOCATIONS[typeof assignedProfile] }[]).map(({ label, key }) => (
                  <View key={key} style={styles.allocRow}>
                    <Text style={styles.allocLabel}>{label}</Text>
                    <Text style={styles.allocValue}>{PROFILE_ALLOCATIONS[assignedProfile][key]} %</Text>
                  </View>
                ))}
              </View>

              {isIrregular && (
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#60a5fa" />
                  <Text style={styles.infoText}>
                    Vos revenus irréguliers sont pris en compte. Les indicateurs seront calculés sur une moyenne glissante.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Navigation */}
          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity
                style={styles.footerBtnSecondary}
                onPress={() => setStep(prev => Math.max(1, prev - 1))}
              >
                <Ionicons name="arrow-back" size={18} color={COLORS.text} />
                <Text style={styles.footerBtnSecondaryText}>Précédent</Text>
              </TouchableOpacity>
            )}

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
                <Text style={styles.footerBtnText}>Continuer</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.footerBtn, (loading || !assignedProfile) && styles.footerBtnDisabled]}
                onPress={handleFinish}
                disabled={loading || !assignedProfile}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.bg} />
                  : <>
                      <Text style={styles.footerBtnText}>Démarrer</Text>
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.bg} />
                    </>}
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, gap: 4 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 14, color: COLORS.textSecondary },

  progressBar: {
    height: 3, backgroundColor: '#1e293b',
    marginHorizontal: 24, borderRadius: 2, marginBottom: 6,
  },
  progressFill: { height: 3, backgroundColor: COLORS.emerald, borderRadius: 2 },
  progressLabel: { fontSize: 12, color: COLORS.textSecondary, paddingHorizontal: 24, marginBottom: 12 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 100, gap: 16 },

  card: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 20, padding: 20, gap: 14,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  cardText: { color: '#cbd5e1', lineHeight: 20, fontSize: 14 },

  questionLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
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

  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#1e293b', borderRadius: 10, padding: 12,
  },
  infoText: { flex: 1, color: '#93c5fd', fontSize: 12, lineHeight: 18 },

  profileCard: {
    borderWidth: 2, borderRadius: 16, padding: 20,
    alignItems: 'center', gap: 8, backgroundColor: '#0c1a2e',
  },
  profileEmoji: { fontSize: 40 },
  profileName: { fontSize: 20, fontWeight: '800' },
  profileTier: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  profileDesc: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, textAlign: 'center' },

  allocCard: {
    backgroundColor: '#020617', borderRadius: 14, padding: 16, gap: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  allocTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  allocRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allocLabel: { color: COLORS.text, fontSize: 14 },
  allocValue: { color: COLORS.emerald, fontWeight: '700', fontSize: 15 },

  footer: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'center' },
  footerBtn: {
    flex: 1, backgroundColor: COLORS.emerald, borderRadius: 14,
    paddingVertical: 15, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 8,
  },
  footerBtnDisabled: { opacity: 0.5 },
  footerBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 15 },
  footerBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16,
  },
  footerBtnSecondaryText: { color: COLORS.text, fontWeight: '600', fontSize: 15 },
});
