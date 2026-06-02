/**
 * Questionnaire d'onboarding — 1 question par écran, animé.
 * Affiché aux nouveaux utilisateurs ET aux utilisateurs existants sans profil.
 * Reprend là où l'utilisateur s'était arrêté si non terminé.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useAppColors } from './hooks/useAppColors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './contexts/AuthContext';
import { useProfile, useUpdateProfile } from './hooks/useProfile';
import CurrencyPicker from './components/CurrencyPicker';
import { useSaveQuestionnaire } from './hooks/useFinancialProfile';
import { useCategories, useSeedDefaultCategories } from './hooks/useCategories';
import { useSeedDefaultAccounts } from './hooks/useAccounts';
import {
  Q1_OPTIONS, Q2_OPTIONS, Q3_OPTIONS, Q4_OPTIONS,
  Q5_OPTIONS, Q6_OPTIONS, Q7_OPTIONS,
  computeInitialProfile, detectIrregularIncome,
  PROFILE_INFO, PROFILE_ALLOCATIONS, safetyMarginFromQ8,
} from './lib/financialProfileEngine';
import type { QuestionnaireAnswers } from './lib/financialProfileEngine';
import type { FinancialProfileId } from './types/database';
import {
  saveQuestionnaireProgress,
  loadQuestionnaireProgress,
  clearQuestionnaireProgress,
} from './hooks/useFirstVisitGuide';

const { width: SCREEN_WIDTH } = Dimensions.get('window');


// ── Données des questions ────────────────────────────────────

const QUESTIONS: Array<{
  key: keyof QuestionnaireAnswers;
  label: string;
  options: readonly string[];
}> = [
  { key: 'q1', label: 'Quel type de revenu possédez-vous ?', options: Q1_OPTIONS },
  { key: 'q2', label: 'À quelle fréquence vos revenus principaux sont-ils versés ?', options: Q2_OPTIONS },
  { key: 'q3', label: 'Quel est le montant moyen de vos revenus nets par mois ?', options: Q3_OPTIONS },
  { key: 'q4', label: 'Une fois vos factures et dépenses obligatoires payées, que reste-t-il ?', options: Q4_OPTIONS },
  { key: 'q5', label: 'Si vos revenus s\'arrêtaient demain, combien de temps pourriez-vous maintenir votre niveau de vie grâce à votre épargne disponible ?', options: Q5_OPTIONS },
  { key: 'q6', label: 'Quel pourcentage approximatif de vos revenus mettez-vous de côté chaque mois ?', options: Q6_OPTIONS },
  { key: 'q7', label: 'Quel est votre objectif prioritaire avec cette application ?', options: Q7_OPTIONS },
  // Q8 : rendu spécial (TextInput), pas d'options
  { key: 'q8', label: 'Quel montant minimum souhaitez-vous toujours conserver sur vos comptes courants, quoi qu\'il arrive ?', options: [] },
  // Q9 : rendu spécial (TextInput), pas d'options
  { key: 'q9', label: 'Combien dépensez-vous environ par semaine pour vos courses, loisirs et dépenses variables ?', options: [] },
];

// 0 = welcome, 1-9 = questions, 10 = résultat
const TOTAL_STEPS = 11;

// ── Sous-composants ──────────────────────────────────────────

function OptionCard({
  label, selected, onSelect, multiSelect = false,
}: { label: string; selected: boolean; onSelect: () => void; multiSelect?: boolean }) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  return (
    <TouchableOpacity
      style={[styles.optionCard, selected && styles.optionCardActive]}
      onPress={onSelect}
      activeOpacity={0.75}
    >
      {multiSelect ? (
        <View style={[styles.checkbox, selected && styles.checkboxActive]}>
          {selected && <Ionicons name="checkmark" size={13} color="#000" />}
        </View>
      ) : (
        <View style={[styles.radio, selected && styles.radioActive]}>
          {selected && <View style={styles.radioDot} />}
        </View>
      )}
      <Text style={[styles.optionLabel, selected && styles.optionLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Écran principal ──────────────────────────────────────────

export default function QuestionnaireScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const updateProfile = useUpdateProfile(user?.id);
  const { data: userProfile } = useProfile(user?.id);
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);
  const { data: existingCategories = [] } = useCategories(user?.id);
  const seedDefaultCategories = useSeedDefaultCategories(user?.id);
  const seedDefaultAccounts = useSeedDefaultAccounts(user?.id);

  // Charger la progression sauvegardée
  const savedProgress = useMemo(() => loadQuestionnaireProgress(user?.id), [user?.id]);

  const [step, setStep] = useState(savedProgress?.currentStep ?? 0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(
    (savedProgress?.answers as unknown as QuestionnaireAnswers) ?? {
      q1: '', q2: '', q3: '', q4: '', q5: '', q6: '', q7: '', q8: '', q9: '',
    }
  );
  const [saving, setSaving] = useState(false);

  // Q6 calculateur
  const [q6Income, setQ6Income] = useState('');
  const [q6Savings, setQ6Savings] = useState('');
  const q6Pct = useMemo(() => {
    const inc = parseFloat(q6Income.replace(',', '.'));
    const sav = parseFloat(q6Savings.replace(',', '.'));
    if (!inc || inc <= 0 || isNaN(sav) || sav < 0) return null;
    return Math.round((sav / inc) * 100);
  }, [q6Income, q6Savings]);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(step / (TOTAL_STEPS - 1))).current;

  function animateToStep(next: number, direction: 1 | -1 = 1) {
    Animated.timing(slideAnim, {
      toValue: -direction * SCREEN_WIDTH * 0.3,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setStep(next);
      slideAnim.setValue(direction * SCREEN_WIDTH * 0.3);
      Animated.spring(slideAnim, {
        toValue: 0, tension: 80, friction: 12, useNativeDriver: true,
      }).start();
    });
    Animated.timing(progressAnim, {
      toValue: next / (TOTAL_STEPS - 1),
      duration: 300,
      useNativeDriver: false,
    }).start();
  }

  function handleSelect(key: keyof QuestionnaireAnswers, value: string) {
    if (key === 'q1') {
      // Multi-select : séparer par "|"
      const current = answers.q1 ? answers.q1.split('|') : [];
      const newValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const newAnswers = { ...answers, q1: newValues.join('|') };
      setAnswers(newAnswers);
      saveQuestionnaireProgress(user?.id, { currentStep: step, answers: newAnswers });
    } else {
      const newAnswers = { ...answers, [key]: value };
      setAnswers(newAnswers);
      saveQuestionnaireProgress(user?.id, { currentStep: step, answers: newAnswers });
    }
  }

  function handleNext() {
    if (step === 0) {
      animateToStep(1);
      return;
    }
    const q = QUESTIONS[step - 1];
    // Q8 et Q9 : vide = "je ne sais pas" (valeur 0), toujours valide
    if (q.key !== 'q8' && q.key !== 'q9' && !answers[q.key]) {
      Alert.alert('Sélection requise', 'Choisissez une réponse pour continuer.');
      return;
    }
    if (step < 9) {
      animateToStep(step + 1);
    } else {
      animateToStep(10);
    }
  }

  function handleBack() {
    if (step <= 0) return;
    animateToStep(step - 1, -1);
  }

  async function handleFinish() {
    if (!user?.id) return;
    setSaving(true);
    try {
      // Étape critique : crée le profil financier (source de vérité de l'onboarding)
      await saveQuestionnaire.mutateAsync({ answers });
    } catch (e: unknown) {
      console.error('[questionnaire] saveQuestionnaire échoué:', e);
      Alert.alert('Erreur', (e as any)?.message ?? 'Impossible d\'enregistrer le questionnaire.');
      setSaving(false);
      return;
    }

    // Créer les catégories par défaut si l'utilisateur n'en a pas encore
    // (pour que le plan de trésorerie ne soit pas vide à l'arrivée).
    if (existingCategories.length === 0) {
      try {
        await seedDefaultCategories.mutateAsync();
      } catch (e: unknown) {
        console.warn('[questionnaire] seed catégories par défaut échoué (non bloquant):', e);
      }
    }

    // Créer les comptes par défaut (Compte courant + Livret A + LDDS) si aucun compte.
    try {
      await seedDefaultAccounts.mutateAsync();
    } catch (e: unknown) {
      console.warn('[questionnaire] seed comptes par défaut échoué (non bloquant):', e);
    }

    // Best-effort : marquer l'onboarding terminé dans profiles.
    // Non bloquant : l'existence du profil financier suffit pour passer le guard.
    try {
      await updateProfile.mutateAsync({ initial_onboarding_completed: true });
    } catch (e: unknown) {
      console.warn('[questionnaire] flag initial_onboarding_completed non persisté (non bloquant):', e);
    }

    clearQuestionnaireProgress(user.id);
    setSaving(false);
    router.replace('/(tabs)/comptes?welcome=1' as any);
  }

  const assignedProfile = useMemo((): FinancialProfileId | null => {
    if (answers.q5 && answers.q4 && answers.q6) return computeInitialProfile(answers);
    return null;
  }, [answers]);

  const isIrregular = detectIrregularIncome(answers.q1, answers.q2);
  const currentQ = step >= 1 && step <= 9 ? QUESTIONS[step - 1] : null;
  const profile = assignedProfile ? PROFILE_INFO[assignedProfile] : null;
  const alloc = assignedProfile ? PROFILE_ALLOCATIONS[assignedProfile] : null;

  // ── Rendu ──────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>

        {/* Barre de progression */}
        {step > 0 && step < 10 && (
          <View style={styles.progressContainer}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
              <Ionicons name="arrow-back" size={22} color="#94a3b8" />
            </TouchableOpacity>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{step}/8</Text>
          </View>
        )}

        {/* Contenu animé */}
        <Animated.View
          style={[styles.contentWrap, { transform: [{ translateX: slideAnim }] }]}
        >

          {/* ── Écran 0 : Welcome ────────────────────────── */}
          {step === 0 && (
            <ScrollView contentContainerStyle={styles.centeredScreen} showsVerticalScrollIndicator={false}>
              <Text style={styles.welcomeEmoji}>📊</Text>
              <Text style={styles.welcomeTitle}>Bienvenue sur Trésorerie</Text>
              <Text style={styles.welcomeSub}>Votre coach financier personnel</Text>
              <View style={styles.welcomeDivider} />
              <Text style={styles.welcomeBody}>
                Avant de commencer, répondez à{' '}
                <Text style={{ color: COLORS.emerald, fontWeight: '700' }}>7 questions rapides</Text>
                {' '}pour que l'application adapte ses recommandations à votre situation financière réelle.
              </Text>
              <Text style={styles.welcomeTime}>⏱ Moins de 2 minutes</Text>

              <View style={styles.welcomeCurrency}>
                <Text style={styles.welcomeCurrencyLabel}>Votre devise</Text>
                <CurrencyPicker
                  value={userProfile?.currency_code ?? 'EUR'}
                  onChange={(code) => updateProfile.mutate({ currency_code: code })}
                />
                <Text style={styles.welcomeCurrencyHint}>Modifiable à tout moment dans les paramètres.</Text>
              </View>

              {savedProgress && savedProgress.currentStep > 0 && (
                <View style={styles.resumeBanner}>
                  <Ionicons name="refresh-circle-outline" size={18} color="#f59e0b" />
                  <Text style={styles.resumeText}>
                    Questionnaire non terminé — reprise à la question {savedProgress.currentStep}/7
                  </Text>
                </View>
              )}

              <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
                <Text style={styles.primaryBtnLabel}>Commencer</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* ── Écrans 1-8 : Questions ─────────────────── */}
          {step >= 1 && step <= 9 && currentQ && (
            <View style={styles.questionScreen}>
              <Text style={styles.questionNum}>Question {step} sur 9</Text>
              <Text style={styles.questionText}>{currentQ.label}</Text>

              {step === 2 && isIrregular && (
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={15} color="#60a5fa" />
                  <Text style={styles.infoText}>
                    Revenus irréguliers détectés — calculs sur moyenne glissante.
                  </Text>
                </View>
              )}

              {/* ── Q8 / Q9 : saisie d'un montant (€) ── */}
              {step === 8 || step === 9 ? (
                <ScrollView
                  style={styles.optionsScroll}
                  contentContainerStyle={styles.optionsContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.infoBox}>
                    <Ionicons name={step === 8 ? 'shield-checkmark-outline' : 'cart-outline'} size={15} color="#60a5fa" />
                    <Text style={styles.infoText}>
                      {step === 8
                        ? 'Ce montant est toujours conservé avant de calculer ce que vous pouvez dépenser ou investir.'
                        : 'Sert à estimer votre enveloppe de dépenses variables (courses, loisirs, imprévus) au début, tant que l’historique est insuffisant. Montant par semaine.'}
                    </Text>
                  </View>
                  <TextInput
                    style={styles.q8Input}
                    value={step === 8 ? answers.q8 : answers.q9}
                    onChangeText={(v) => { const clean = v.replace(/[^0-9.,]/g, ''); handleSelect(step === 8 ? 'q8' : 'q9', clean ? String(parseFloat(clean.replace(',', '.')) || '') : ''); }}
                    keyboardType="decimal-pad"
                    placeholder={step === 8 ? 'Ex. 500' : 'Ex. 120'}
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.q8Currency}>{step === 8 ? '€' : '€ / semaine'}</Text>
                  {step === 9 && answers.q9 ? (
                    <Text style={[styles.q8DontKnowText, { textAlign: 'center', marginTop: 8 }]}>
                      ≈ {Math.round(parseFloat(answers.q9.replace(',', '.') || '0') * 4.33).toLocaleString('fr-FR')} € / mois
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.q8DontKnow}
                    onPress={() => {
                      handleSelect(step === 8 ? 'q8' : 'q9', '');
                      handleNext();
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.q8DontKnowText}>Je ne sais pas → on l’estimera</Text>
                  </TouchableOpacity>
                  <View style={{ height: 100 }} />
                </ScrollView>
              ) : (
              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.optionsContent}
                showsVerticalScrollIndicator={false}
              >
                {/* Q1 : indication multi-select */}
                {step === 1 && (
                  <View style={styles.infoBox}>
                    <Ionicons name="checkbox-outline" size={15} color="#60a5fa" />
                    <Text style={styles.infoText}>Vous pouvez sélectionner plusieurs types de revenus.</Text>
                  </View>
                )}

                {/* Q6 : calculateur de % */}
                {step === 6 && (
                  <View style={styles.calculatorBox}>
                    <Text style={styles.calcTitle}>Calculateur (optionnel)</Text>
                    <View style={styles.calcRow}>
                      <View style={styles.calcField}>
                        <Text style={styles.calcLabel}>Revenus nets /mois</Text>
                        <TextInput
                          style={styles.calcInput}
                          value={q6Income}
                          onChangeText={setQ6Income}
                          keyboardType="decimal-pad"
                          placeholder="ex. 2500"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                      <View style={styles.calcField}>
                        <Text style={styles.calcLabel}>Épargne /mois</Text>
                        <TextInput
                          style={styles.calcInput}
                          value={q6Savings}
                          onChangeText={setQ6Savings}
                          keyboardType="decimal-pad"
                          placeholder="ex. 300"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                    </View>
                    {q6Pct !== null && (
                      <View style={styles.calcResult}>
                        <Text style={styles.calcResultLabel}>Votre taux d'épargne estimé</Text>
                        <Text style={styles.calcResultValue}>{q6Pct} %</Text>
                      </View>
                    )}
                  </View>
                )}

                {currentQ.options.map((opt) => (
                  <OptionCard
                    key={opt}
                    label={opt}
                    selected={
                      step === 1
                        ? answers.q1.split('|').includes(opt)
                        : answers[currentQ.key] === opt
                    }
                    onSelect={() => handleSelect(currentQ.key, opt)}
                    multiSelect={step === 1}
                  />
                ))}
                <View style={{ height: 100 }} />
              </ScrollView>
              )}

              <View style={styles.questionFooter}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1 }, (step < 8 && !answers[currentQ.key]) && styles.btnDisabled]}
                  onPress={handleNext}
                  disabled={step < 8 && !answers[currentQ.key]}
                >
                  <Text style={styles.primaryBtnLabel}>
                    {step === 9 ? 'Voir mon profil' : 'Continuer'}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Écran 10 : Résultat ───────────────────── */}
          {step === 10 && profile && assignedProfile && alloc && (
            <ScrollView contentContainerStyle={styles.resultScreen} showsVerticalScrollIndicator={false}>
              <View style={styles.resultBadge}>
                <Text style={styles.resultBadgeText}>Profil attribué !</Text>
              </View>

              <Text style={styles.resultEmoji}>{profile.emoji}</Text>
              <Text style={[styles.resultName, { color: profile.color }]}>{profile.name}</Text>
              <Text style={styles.resultTier}>{profile.tier}</Text>
              <Text style={styles.resultDesc}>{profile.description}</Text>

              {isIrregular && (
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={15} color="#60a5fa" />
                  <Text style={styles.infoText}>
                    Revenus irréguliers pris en compte via une moyenne glissante.
                  </Text>
                </View>
              )}

              <View style={styles.allocCard}>
                <Text style={styles.allocTitle}>Votre allocation recommandée</Text>
                {([
                  { label: 'Épargner',        key: 'save'   as const, color: '#34d399' },
                  { label: 'Investir',         key: 'invest' as const, color: '#a78bfa' },
                  { label: 'Se faire plaisir', key: 'enjoy'  as const, color: '#f59e0b' },
                  { label: 'Conserver',        key: 'keep'   as const, color: '#60a5fa' },
                ]).map(({ label, key, color }) => {
                  const pct = alloc[key];
                  return (
                    <View key={key} style={styles.allocRow}>
                      <View style={[styles.allocDot, { backgroundColor: color }]} />
                      <Text style={styles.allocLabel}>{label}</Text>
                      <View style={styles.allocBarBg}>
                        <View style={[styles.allocBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={[styles.allocPct, { color }]}>{pct}%</Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.freezeNote}>
                <Ionicons name="lock-closed-outline" size={14} color="#94a3b8" />
                <Text style={styles.freezeText}>
                  Ce profil reste actif 6 mois, puis évolue automatiquement selon vos données réelles.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, saving && styles.btnDisabled]}
                onPress={handleFinish}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.bg} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnLabel}>Créer mes comptes</Text>
                    <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
                  </>
                )}
              </TouchableOpacity>

              <View style={{ height: 40 }} />
            </ScrollView>
          )}

        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1 },
  contentWrap: { flex: 1 },

  // Barre de progression
  progressContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  progressTrack: {
    flex: 1, height: 4, backgroundColor: c.cardBorder, borderRadius: 2,
  },
  progressFill: { height: 4, backgroundColor: c.emerald, borderRadius: 2 },
  progressLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600', minWidth: 24 },

  // Welcome
  centeredScreen: {
    flexGrow: 1, alignItems: 'center', paddingHorizontal: 28,
    paddingTop: 40, paddingBottom: 60, gap: 12,
  },
  welcomeCurrency: { width: '100%', marginTop: 24, gap: 8 },
  welcomeCurrencyLabel: { fontSize: 14, fontWeight: '700', color: c.text },
  welcomeCurrencyHint: { fontSize: 12, color: c.textSecondary },
  welcomeEmoji: { fontSize: 72, marginBottom: 8 },
  welcomeTitle: { fontSize: 28, fontWeight: '800', color: c.text, textAlign: 'center' },
  welcomeSub: { fontSize: 16, color: c.emerald, fontWeight: '600', marginBottom: 4 },
  welcomeDivider: { width: 40, height: 2, backgroundColor: c.cardBorder, marginVertical: 8 },
  welcomeBody: {
    fontSize: 16, color: '#cbd5e1', textAlign: 'center', lineHeight: 24,
  },
  welcomeTime: {
    fontSize: 13, color: '#94a3b8',
    backgroundColor: c.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  resumeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#2a1f0a', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#f59e0b40',
  },
  resumeText: { flex: 1, fontSize: 13, color: '#fbbf24', lineHeight: 18 },

  // Questions
  questionScreen: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  questionNum: { fontSize: 12, color: c.emerald, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  questionText: { fontSize: 20, fontWeight: '700', color: c.text, lineHeight: 28, marginBottom: 20 },
  optionsScroll: { flex: 1 },
  optionsContent: { gap: 10 },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 14, padding: 16,
  },
  optionCardActive: {
    borderColor: c.emerald, backgroundColor: c.selected,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#475569',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  radioActive: { borderColor: c.emerald },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.emerald },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 2, borderColor: '#475569',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  checkboxActive: { borderColor: c.emerald, backgroundColor: c.emerald },
  calculatorBox: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: '#60a5fa40',
    padding: 14, marginBottom: 14, gap: 10,
  },
  calcTitle: { fontSize: 12, fontWeight: '700', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 0.5 },
  calcRow: { flexDirection: 'row', gap: 10 },
  calcField: { flex: 1, gap: 4 },
  calcLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  calcInput: {
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: c.text,
  },
  calcResult: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#60a5fa18', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#60a5fa40',
  },
  calcResultLabel: { fontSize: 13, color: '#93c5fd', fontWeight: '600' },
  calcResultValue: { fontSize: 22, fontWeight: '800', color: '#60a5fa' },
  optionLabel: { flex: 1, fontSize: 15, color: '#94a3b8', lineHeight: 22 },
  optionLabelActive: { color: c.text },
  questionFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 24, backgroundColor: c.bg,
    borderTopWidth: 1, borderTopColor: c.card,
  },

  // Résultat
  resultScreen: {
    alignItems: 'center', paddingHorizontal: 24,
    paddingTop: 32, gap: 16,
  },
  resultBadge: {
    backgroundColor: '#1a3a2a', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 6,
    borderWidth: 1, borderColor: c.emerald + '40',
  },
  resultBadgeText: { fontSize: 12, color: c.emerald, fontWeight: '700' },
  resultEmoji: { fontSize: 72 },
  resultName: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  resultTier: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  resultDesc: { fontSize: 15, color: '#cbd5e1', textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },

  allocCard: {
    width: '100%', backgroundColor: c.card, borderRadius: 16,
    padding: 18, gap: 12, borderWidth: 1, borderColor: c.cardBorder,
  },
  allocTitle: { fontSize: 13, fontWeight: '600', color: '#94a3b8', marginBottom: 4 },
  allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocLabel: { width: 110, fontSize: 13, color: c.text },
  allocBarBg: { flex: 1, height: 5, backgroundColor: c.cardBorder, borderRadius: 3 },
  allocBarFill: { height: 5, borderRadius: 3 },
  allocPct: { width: 36, fontSize: 13, fontWeight: '700', textAlign: 'right' },

  freezeNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  freezeText: { flex: 1, fontSize: 12, color: '#94a3b8', lineHeight: 18 },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.cardBorder, borderRadius: 10, padding: 10, width: '100%',
  },
  infoText: { flex: 1, fontSize: 12, color: '#93c5fd', lineHeight: 18 },
  q8Input: {
    backgroundColor: c.card, borderWidth: 2, borderColor: c.emerald,
    borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20,
    fontSize: 32, fontWeight: '700', color: c.text, textAlign: 'center',
    marginTop: 20,
  },
  q8Currency: {
    fontSize: 18, color: c.textSecondary, fontWeight: '600',
    textAlign: 'center', marginTop: 8,
  },
  q8DontKnow: {
    marginTop: 20, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'center',
  },
  q8DontKnowText: { fontSize: 14, color: c.textSecondary, fontWeight: '500' },

  // Bouton principal
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: c.emerald,
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 28,
    width: '100%',
  },
  primaryBtnLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  btnDisabled: { opacity: 0.5 },
});
}
