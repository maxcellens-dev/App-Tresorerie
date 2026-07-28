/**
 * SOCLE DE DÉMARRAGE — 5 écrans qui INSTALLENT le compte au lieu de l'interroger.
 *
 * Ce qui change par rapport à l'ancien questionnaire (app/questionnaire.tsx, conservé pour les
 * comptes existants) : là où 11 écrans posaient 9 questions sans créer la moindre donnée, ces
 * 5 écrans créent le compte courant à la bonne devise, la rentrée d'argent récurrente, les charges
 * fixes et les comptes d'épargne / investissement. À la sortie, le Relyka veut dire quelque chose.
 *
 * Les 3 réponses qui manquent encore (q4, q6 pour le profil ; q8, q9 pour la précision) sont posées
 * à l'usage — cf. lib/progressiveProfile. Et q5 n'est plus DÉCLARÉE mais MESURÉE : elle se déduit
 * de l'épargne saisie à l'écran 4 (épargne ÷ revenu, définition exacte du matelas de sécurité).
 *
 * Chaque écran montre un GESTE que l'utilisateur devra refaire : ajouter un compte, ajouter une
 * récurrence. C'est aussi une démonstration, pas seulement un formulaire.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Animated, ActivityIndicator, Modal, Image, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import ScreenGradient from '../components/ScreenGradient';
import CurrencyPicker from '../components/CurrencyPicker';
import InfoDot from '../components/InfoDot';
import { useAppColors } from '../hooks/useAppColors';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../hooks/useBrandFont';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useAccounts, useAddAccount } from '../hooks/useAccounts';
import { useCategories, useSeedDefaultCategories } from '../hooks/useCategories';
import { useAddTransaction } from '../hooks/useTransactions';
import { useSaveQuestionnaire } from '../hooks/useFinancialProfile';
import { supabase } from '../lib/supabase';
import { currencySymbolFor } from '../lib/currency';
import { signalAppReady } from '../lib/splashGate';
import {
  Q1_OPTIONS, Q2_OPTIONS, NEUTRAL_ANSWERS,
  q3FromMonthlyIncome, deriveQ5,
} from '../lib/financialProfileEngine';
import type { QuestionnaireAnswers } from '../lib/financialProfileEngine';

/* ── Modèles de saisie ────────────────────────────────────────────────────── */

type Rhythm = 'fixe' | 'variable' | 'mixte';

/** Correspondance rythme → réponses q1/q2 attendues par le moteur (chaînes littérales). */
const RHYTHM_TO_ANSWERS: Record<Rhythm, { q1: string; q2: string }> = {
  fixe:     { q1: Q1_OPTIONS[0], q2: Q2_OPTIONS[0] },
  variable: { q1: Q1_OPTIONS[1], q2: Q2_OPTIONS[3] },
  // Mixte : un salaire fixe ET un revenu d'activité variable → le moteur retient la régularité du
  // salaire (detectIrregularIncome n'est vrai que si TOUS les revenus sont irréguliers).
  mixte:    { q1: `${Q1_OPTIONS[0]}|${Q1_OPTIONS[1]}`, q2: Q2_OPTIONS[1] },
};

const RHYTHMS: { key: Rhythm; label: string; hint: string; icon: string }[] = [
  { key: 'fixe',     label: 'Le même montant chaque mois', hint: 'Salaire, retraite, pension',    icon: 'remove-outline' },
  { key: 'variable', label: 'Ça change d’un mois à l’autre', hint: 'Freelance, primes, missions', icon: 'pulse-outline' },
  { key: 'mixte',    label: 'Un fixe + des compléments',     hint: 'Un salaire et des extras',    icon: 'git-merge-outline' },
];

/** Charges fixes proposées en un tap. `cat` = nom de la sous-catégorie par défaut à rattacher. */
const CHARGE_PRESETS: { key: string; label: string; cat: string; icon: string }[] = [
  { key: 'loyer',      label: 'Loyer ou crédit immo', cat: 'Loyer',                 icon: 'home-outline' },
  { key: 'energie',    label: 'Énergie',              cat: 'Electricité, Eau, Gaz', icon: 'flash-outline' },
  { key: 'telephone',  label: 'Téléphone & internet', cat: 'Internet mobile',       icon: 'phone-portrait-outline' },
  { key: 'abo',        label: 'Abonnements',          cat: 'Autres abonnements',    icon: 'tv-outline' },
  { key: 'assurance',  label: 'Assurances',           cat: 'Assurance habitation',  icon: 'umbrella-outline' },
  { key: 'transport',  label: 'Transport',            cat: 'Transports en commun',  icon: 'bus-outline' },
  { key: 'credit',     label: 'Crédit',               cat: 'Crédits',               icon: 'card-outline' },
  { key: 'autre',      label: 'Autre charge',         cat: 'Autres charges',        icon: 'ellipsis-horizontal' },
];

/** Comptes proposés à l'écran 4 — création RAPIDE : ni enveloppe fiscale, ni date d'ouverture. */
const ACCOUNT_PRESETS: { key: string; label: string; type: string; hint: string; icon: string }[] = [
  { key: 'livret',  label: 'Livret A',            type: 'savings',    hint: 'Épargne disponible',    icon: 'leaf-outline' },
  { key: 'ldds',    label: 'LDDS',                type: 'savings',    hint: 'Épargne disponible',    icon: 'leaf-outline' },
  { key: 'autreEp', label: 'Autre épargne',       type: 'savings',    hint: 'PEL, CEL, livret bancaire', icon: 'leaf-outline' },
  { key: 'invest',  label: 'Compte-titres ou PEA', type: 'investment', hint: 'Placements',            icon: 'trending-up-outline' },
  { key: 'courant2', label: 'Autre compte courant', type: 'checking',  hint: 'Second compte du quotidien', icon: 'wallet-outline' },
];

interface ChargeEntry { key: string; label: string; cat: string; amount: string }
interface AccountEntry { key: string; label: string; type: string; amount: string }

/** Jour par défaut des charges fixes — la date exacte se règle ensuite dans Transactions. */
const DEFAULT_CHARGE_DAY = 5;

/** Raccourcis de jour de versement ; tout autre jour passe par la saisie libre. */
const DAY_SHORTCUTS = [1, 2, 5, 10, 15, 25, 28, 30];

const TOTAL_STEPS = 5;

/* ── Écran ────────────────────────────────────────────────────────────────── */

export default function OnboardingScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFontStyle = useAppNameFontStyle();
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => { signalAppReady(); }, []);

  const { data: userProfile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const seedCategories = useSeedDefaultCategories(user?.id);
  const addAccount = useAddAccount(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  const saveQuestionnaire = useSaveQuestionnaire(user?.id);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Ligne en cours de saisie : c'est la LIGNE ENTIÈRE qui s'allume, pas un anneau autour du champ.
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // Écran 1 — compte principal
  const currency = userProfile?.currency_code ?? 'EUR';
  const symbol = currencySymbolFor(currency);
  const [mainName, setMainName] = useState('Compte courant');
  const [mainBalance, setMainBalance] = useState('');
  const [mainAccountId, setMainAccountId] = useState<string | null>(null);

  // Écran 2 — rentrée d'argent
  const [incomeAmount, setIncomeAmount] = useState('');
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  const [incomeDay, setIncomeDay] = useState('');

  // Écran 3 — charges fixes
  const [charges, setCharges] = useState<ChargeEntry[]>([]);

  // Écran 4 — autres comptes
  const [others, setOthers] = useState<AccountEntry[]>([]);

  // Les catégories sont indispensables dès l'écran 2 (rattachement des récurrences) : on les crée
  // au montage, en tâche de fond, pour ne pas ajouter une attente au moment du « Continuer ».
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !user?.id) return;
    if (categories.length > 0) { seeded.current = true; return; }
    seeded.current = true;
    seedCategories.mutateAsync().catch(() => { seeded.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, categories.length]);

  // Reprise : si un compte courant existe déjà (démarrage interrompu), on le réutilise au lieu
  // d'en créer un second — la création refuserait de toute façon un nom en double.
  useEffect(() => {
    if (mainAccountId) return;
    const existing = accounts.find((a: any) => a.type === 'checking' && !a.is_joint);
    if (existing) {
      setMainAccountId((existing as any).id);
      setMainName((existing as any).name);
      if (Number((existing as any).balance) !== 0) setMainBalance(String(Number((existing as any).balance)));
    }
  }, [accounts, mainAccountId]);

  /* ── Navigation animée ── */
  const goTo = (next: number) => {
    Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  /* ── Helpers ── */
  const num = (s: string) => {
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const chargesTotal = charges.reduce((s, c) => s + num(c.amount), 0);
  const savingsTotal = others
    .filter((o) => o.type === 'savings' || o.type === 'investment')
    .reduce((s, o) => s + num(o.amount), 0);
  const incomeValue = num(incomeAmount);
  const theoretical = Math.max(0, incomeValue - chargesTotal);

  /** Catégorie (sous-catégorie de préférence) par nom exact, sinon repli sur le type. */
  const findCategory = (name: string, type: 'income' | 'expense'): string | null => {
    const exact = categories.find((c: any) => c.name === name && c.type === type);
    if (exact) return (exact as any).id;
    const child = categories.find((c: any) => c.type === type && c.parent_id);
    return child ? (child as any).id : null;
  };

  /** Date d'une occurrence dans le mois courant, jour borné au nombre de jours du mois. */
  const dateInCurrentMonth = (day: number) => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const d = Math.min(Math.max(1, Math.round(day)), last);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const fail = (e: unknown, what: string) => {
    console.error('[onboarding]', what, e);
    Alert.alert('Un souci', (e as any)?.message ?? `Impossible d'enregistrer ${what}.`);
    setBusy(null);
  };

  /* ── Étape 1 : créer le compte principal ── */
  async function submitMain() {
    if (!user?.id) return;
    const name = mainName.trim() || 'Compte courant';
    setBusy('Création de ton compte…');
    try {
      if (!mainAccountId) {
        const created = await addAccount.mutateAsync({
          name, type: 'checking', currency, balance: num(mainBalance), is_default: true,
        });
        setMainAccountId((created as any)?.id ?? null);
      }
      setBusy(null);
      goTo(1);
    } catch (e) { fail(e, 'ton compte courant'); }
  }

  /* ── Étape 2 : créer la rentrée d'argent récurrente ── */
  async function submitIncome() {
    if (!user?.id || !mainAccountId) return;
    setBusy('Enregistrement de ta rentrée d’argent…');
    try {
      const day = num(incomeDay) || 1;
      await addTransaction.mutateAsync({
        account_id: mainAccountId,
        category_id: findCategory('Salaire, Traitement', 'income'),
        amount: Math.abs(incomeValue),
        date: dateInCurrentMonth(day),
        note: rhythm === 'variable' ? 'Revenus' : 'Salaire',
        is_recurring: true,
        recurrence_rule: 'monthly',
      });
      setBusy(null);
      goTo(2);
    } catch (e) { fail(e, 'ta rentrée d’argent'); }
  }

  /* ── Étape 3 : créer les charges fixes récurrentes ── */
  async function submitCharges() {
    if (!user?.id || !mainAccountId) return;
    const valid = charges.filter((c) => num(c.amount) > 0);
    if (valid.length === 0) { goTo(3); return; }
    setBusy(`Enregistrement de ${valid.length} charge${valid.length > 1 ? 's' : ''}…`);
    try {
      for (const c of valid) {
        await addTransaction.mutateAsync({
          account_id: mainAccountId,
          category_id: findCategory(c.cat, 'expense'),
          amount: -Math.abs(num(c.amount)),
          date: dateInCurrentMonth(DEFAULT_CHARGE_DAY),
          note: c.label,
          is_recurring: true,
          recurrence_rule: 'monthly',
        });
      }
      setBusy(null);
      goTo(3);
    } catch (e) { fail(e, 'tes charges fixes'); }
  }

  /* ── Étape 4 : créer les autres comptes, puis le profil financier ── */
  async function submitAccountsAndProfile() {
    if (!user?.id) return;
    const valid = others.filter((o) => o.label.trim().length > 0);
    setBusy('On met tout en place…');
    try {
      for (const o of valid) {
        await addAccount.mutateAsync({
          name: o.label.trim(), type: o.type, currency, balance: num(o.amount),
        });
      }

      // q5 MESURÉE : épargne + investissement saisis ÷ revenu déclaré. C'est la définition exacte
      // du matelas de sécurité — plus fiable qu'une auto-évaluation, et elle se recalculera toute
      // seule à chaque changement de solde (useLiveProfileSync).
      const answers: QuestionnaireAnswers = {
        ...RHYTHM_TO_ANSWERS[rhythm ?? 'fixe'],
        q3: q3FromMonthlyIncome(incomeValue),
        q4: NEUTRAL_ANSWERS.q4,
        q5: deriveQ5(savingsTotal, incomeValue),
        q6: NEUTRAL_ANSWERS.q6,
        q7: '',
        q8: '',   // marge de sécurité : demandée à l'usage, 0 € en attendant
        q9: '',   // enveloppe variable : demandée à l'usage, estimée en attendant
      };
      await saveQuestionnaire.mutateAsync({ answers, live: true });

      // Drapeaux de parcours (jsonb existant → aucune migration) : `pp_live` ouvre la phase où le
      // profil se recalcule en direct, `pp_socle` autorise les questions progressives.
      if (supabase) {
        const { data } = await supabase.from('profiles').select('onboarding_state').eq('id', user.id).single();
        const prev = ((data as any)?.onboarding_state ?? {}) as Record<string, any>;
        await supabase.from('profiles')
          .update({ onboarding_state: { ...prev, pp_live: true, pp_socle: true, pp_ev_any: 0 } })
          .eq('id', user.id);
      }
      await updateProfile.mutateAsync({ initial_onboarding_completed: true }).catch(() => {});

      setBusy(null);
      goTo(4);
    } catch (e) { fail(e, 'tes comptes'); }
  }

  /* ── Validation par étape ──────────────────────────────────────────────────────────────────
     Une ligne saisie mais laissée à 0 € créerait une vraie transaction (ou un vrai compte) vide :
     on bloque, et on dit lequel pose problème plutôt que de griser le bouton en silence. */
  const chargesIncomplete = charges.filter((c) => num(c.amount) <= 0);
  const accountsIncomplete = others.filter((o) => num(o.amount) <= 0 || !o.label.trim());

  const blockingMessage: string | null = (() => {
    if (step === 1 && incomeValue > 0 && !!rhythm && !num(incomeDay)) {
      return 'Indique le jour du mois où tu la reçois — c’est ce qui place le creux de trésorerie.';
    }
    if (step === 2) {
      if (charges.length === 0) return 'Ajoute au moins une charge, ou passe l’étape.';
      if (chargesIncomplete.length > 0) {
        return `Il manque un montant : ${chargesIncomplete.map((c) => c.label).join(', ')}.`;
      }
    }
    if (step === 3 && accountsIncomplete.length > 0) {
      return `Il manque un nom ou un solde : ${accountsIncomplete.map((o) => o.label || 'compte sans nom').join(', ')}.`;
    }
    return null;
  })();

  const canNext = [
    mainBalance.trim().length > 0,
    incomeValue > 0 && !!rhythm && num(incomeDay) > 0,
    charges.length > 0 && chargesIncomplete.length === 0,
    accountsIncomplete.length === 0,
    true,
  ][step];

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>

        {/* En-tête de progression sur TOUS les écrans, dernier compris : sans lui, l'écran de
            résultat démarrait dans le vide, sans repère ni rappel de l'avancement.
            Pas de flèche « retour » sur le dernier : les comptes et le profil sont déjà créés. */}
        <View style={styles.progressBar}>
          {step > 0 && step < 4 && (
            <TouchableOpacity onPress={() => goTo(step - 1)} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="arrow-back" size={21} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {step === 4 ? 'Terminé' : `${step + 1}/${TOTAL_STEPS}`}
          </Text>
        </View>

        <Animated.View style={[{ flex: 1 }, { opacity: fade }]}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* ─────────── 1. COMPTE PRINCIPAL ─────────── */}
            {step === 0 && (
              <>
                <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" fadeDuration={0} />
                <Text style={styles.hello}>
                  Bienvenue sur <Text {...APP_NAME_TEXT_PROPS} style={appNameFontStyle}>Relyka</Text>
                </Text>
                <Text style={styles.tagline}>
                  On ne te dit pas combien tu as. On te dit quoi en faire.
                </Text>

                <View style={styles.divider} />

                <Text style={styles.h1}>Ton compte principal</Text>
                <Text style={styles.sub}>
                  Celui où ton argent arrive et tes charges partent.
                  Tu en ajouteras d’autres juste après.
                </Text>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Devise</Text>
                  <CurrencyPicker
                    value={currency}
                    onChange={(code) => updateProfile.mutate({ currency_code: code })}
                  />
                  <Text style={styles.fieldHint}>Modifiable à tout moment.</Text>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>
                    Nom du compte <InfoDot term="compte_principal" size={14} />
                  </Text>
                  <TextField
                    styles={styles}
                    placeholderColor={COLORS.textSecondary}
                    selectionColor={COLORS.emerald}
                    value={mainName}
                    onChangeText={setMainName}
                    placeholder="Compte courant"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Solde aujourd’hui</Text>
                  <AmountField
                    styles={styles}
                    symbol={symbol}
                    placeholderColor={COLORS.textSecondary}
                    selectionColor={COLORS.emerald}
                    value={mainBalance}
                    onChangeText={(v: string) => setMainBalance(v.replace(/[^0-9.,-]/g, ''))}
                  />
                  <Text style={styles.fieldHint}>Recopie le montant affiché dans ton appli bancaire.</Text>
                </View>
              </>
            )}

            {/* ─────────── 2. RENTRÉE D'ARGENT ─────────── */}
            {step === 1 && (
              <>
                <Text style={styles.eyebrow}>Ce qui rentre</Text>
                <Text style={styles.h1}>Ta rentrée d’argent principale</Text>
                <Text style={styles.sub}>
                  Une estimation suffit. C’est la base de tous les calculs : sans elle, l’app ne peut
                  pas anticiper ton mois.
                </Text>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Montant net par mois</Text>
                  <AmountField
                    styles={styles}
                    symbol={symbol}
                    placeholderColor={COLORS.textSecondary}
                    selectionColor={COLORS.emerald}
                    value={incomeAmount}
                    onChangeText={(v: string) => setIncomeAmount(v.replace(/[^0-9.,]/g, ''))}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>C’est plutôt…</Text>
                  {RHYTHMS.map((r) => {
                    const sel = rhythm === r.key;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        style={[styles.choice, sel && styles.choiceSel]}
                        onPress={() => setRhythm(r.key)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name={r.icon as any} size={18} color={sel ? COLORS.emerald : COLORS.textSecondary} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.choiceLabel, sel && { color: COLORS.text, fontWeight: '700' }]}>{r.label}</Text>
                          <Text style={styles.choiceHint}>{r.hint}</Text>
                        </View>
                        {sel && <Ionicons name="checkmark-circle" size={19} color={COLORS.emerald} />}
                      </TouchableOpacity>
                    );
                  })}
                  {rhythm === 'variable' && (
                    <View style={styles.info}>
                      <Ionicons name="information-circle-outline" size={15} color={COLORS.blue} />
                      <Text style={styles.infoText}>
                        Revenus qui varient : on surveillera plus finement les baisses, et on te
                        conseillera une marge de sécurité plus large.
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Vers quel jour du mois ?</Text>
                  <View style={styles.dayRow}>
                    {[1, 2, 5, 10, 15, 25, 28, 30].map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.dayChip, num(incomeDay) === d && styles.dayChipSel]}
                        onPress={() => setIncomeDay(String(d))}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.dayChipText, num(incomeDay) === d && { color: COLORS.bg, fontWeight: '800' }]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                    {/* Saisie libre : les raccourcis ne couvrent pas les 31 jours, et la date compte
                        vraiment ici — c'est elle qui place le creux de trésorerie. */}
                    <TextInput
                      style={[
                        styles.dayChip, styles.dayInput,
                        incomeDay && !DAY_SHORTCUTS.includes(num(incomeDay)) && styles.dayChipSel,
                        focusRow === 'day' && styles.dayInputFocus,
                      ]}
                      onFocus={() => setFocusRow('day')}
                      onBlur={() => setFocusRow(null)}
                      selectionColor={COLORS.emerald}
                      value={incomeDay && !DAY_SHORTCUTS.includes(num(incomeDay)) ? incomeDay : ''}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9]/g, '').slice(0, 2);
                        const n = parseInt(clean, 10);
                        setIncomeDay(clean === '' ? '' : String(Math.min(31, Math.max(1, n || 1))));
                      }}
                      keyboardType="number-pad"
                      placeholder="Autre"
                      placeholderTextColor={COLORS.textSecondary}
                      maxLength={2}
                    />
                  </View>
                  <Text style={styles.fieldHint}>
                    Ça place le creux de trésorerie au bon moment du mois. Approximatif, c’est très bien.
                  </Text>
                </View>

                <View style={styles.demo}>
                  <Ionicons name="repeat" size={15} color={COLORS.emerald} />
                  <Text style={styles.demoText}>
                    On l’enregistre en <Text style={{ fontWeight: '700', color: COLORS.text }}>récurrence mensuelle</Text> :
                    tu ne la saisiras qu’une fois. <InfoDot term="recurrent" size={13} />
                  </Text>
                </View>
              </>
            )}

            {/* ─────────── 3. CHARGES FIXES ─────────── */}
            {step === 2 && (
              <>
                <Text style={styles.eyebrow}>Ce qui part</Text>
                <Text style={styles.h1}>Tes charges fixes</Text>
                <Text style={styles.sub}>
                  Les plus grosses suffisent pour commencer. Chaque ligne ajoutée devient une
                  récurrence mensuelle — le même geste que pour ta rentrée d’argent.
                </Text>

                {charges.map((c, i) => (
                  <View key={c.key} style={[styles.chargeRow, focusRow === `charge:${c.key}` && styles.rowFocus]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chargeLabel}>{c.label}</Text>
                    </View>
                    <TextInput
                      style={styles.chargeInput}
                      value={c.amount}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9.,]/g, '');
                        setCharges((prev) => prev.map((x, j) => (j === i ? { ...x, amount: clean } : x)));
                      }}
                      onFocus={() => setFocusRow(`charge:${c.key}`)}
                      onBlur={() => setFocusRow(null)}
                      selectionColor={COLORS.emerald}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={COLORS.textSecondary}
                      autoFocus={!c.amount}
                    />
                    <Text style={styles.chargeUnit}>{symbol}</Text>
                    <TouchableOpacity
                      onPress={() => setCharges((prev) => prev.filter((_, j) => j !== i))}
                      hitSlop={8}
                      style={{ padding: 2 }}
                    >
                      <Ionicons name="close-circle" size={19} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}

                <Text style={styles.fieldLabel}>Ajouter en un tap</Text>
                <View style={styles.chips}>
                  {CHARGE_PRESETS.map((p) => (
                    <TouchableOpacity
                      key={p.key}
                      style={styles.chip}
                      activeOpacity={0.8}
                      onPress={() => setCharges((prev) => [
                        ...prev,
                        { key: `${p.key}-${prev.length}`, label: p.label, cat: p.cat, amount: '' },
                      ])}
                    >
                      <Ionicons name={p.icon as any} size={14} color={COLORS.emerald} />
                      <Text style={styles.chipText}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {chargesTotal > 0 && (
                  <View style={styles.totalBox}>
                    <Text style={styles.totalLabel}>Total de tes charges fixes</Text>
                    <Text style={styles.totalValue}>
                      {Math.round(chargesTotal).toLocaleString('fr-FR')} {symbol}
                    </Text>
                  </View>
                )}

                <View style={styles.info}>
                  <Ionicons name="alert-circle-outline" size={15} color={COLORS.orange} />
                  <Text style={[styles.infoText, { color: COLORS.orange }]}>
                    C’est l’étape à ne pas sauter : sans tes charges, ton Relyka serait surévalué et
                    les conseils à côté de la plaque.
                  </Text>
                </View>
                <Text style={styles.fieldHint}>
                  On les date du {DEFAULT_CHARGE_DAY} de chaque mois par défaut. Tu pourras ajuster
                  chaque date dans Transactions.
                </Text>
              </>
            )}

            {/* ─────────── 4. AUTRES COMPTES ─────────── */}
            {step === 3 && (
              <>
                <Text style={styles.eyebrow}>Tes autres comptes</Text>
                <Text style={styles.h1}>Où est le reste de ton argent ?</Text>
                <Text style={styles.sub}>
                  Coche ce que tu possèdes et donne le solde. C’est ce qui permet de calculer ton
                  matelas de sécurité <InfoDot term="matelas" size={14} /> — combien de mois tu
                  tiendrais sans rentrée d’argent.
                </Text>

                {others.map((o, i) => (
                  <View key={o.key} style={[styles.acctRow, focusRow === `acct:${o.key}` && styles.rowFocus]}>
                    <TextInput
                      style={styles.acctName}
                      value={o.label}
                      onChangeText={(v) => setOthers((prev) => prev.map((x, j) => (j === i ? { ...x, label: v } : x)))}
                      onFocus={() => setFocusRow(`acct:${o.key}`)}
                      onBlur={() => setFocusRow(null)}
                      selectionColor={COLORS.emerald}
                      placeholder="Nom du compte"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                    <TextInput
                      style={styles.chargeInput}
                      value={o.amount}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9.,]/g, '');
                        setOthers((prev) => prev.map((x, j) => (j === i ? { ...x, amount: clean } : x)));
                      }}
                      onFocus={() => setFocusRow(`acct:${o.key}`)}
                      onBlur={() => setFocusRow(null)}
                      selectionColor={COLORS.emerald}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                    <Text style={styles.chargeUnit}>{symbol}</Text>
                    <TouchableOpacity onPress={() => setOthers((prev) => prev.filter((_, j) => j !== i))} hitSlop={8} style={{ padding: 2 }}>
                      <Ionicons name="close-circle" size={19} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}

                <Text style={styles.fieldLabel}>Ajouter en un tap</Text>
                <View style={styles.chips}>
                  {ACCOUNT_PRESETS.map((p) => (
                    <TouchableOpacity
                      key={p.key}
                      style={styles.chip}
                      activeOpacity={0.8}
                      onPress={() => setOthers((prev) => [
                        ...prev,
                        { key: `${p.key}-${prev.length}`, label: p.label, type: p.type, amount: '' },
                      ])}
                    >
                      <Ionicons name={p.icon as any} size={14} color={COLORS.emerald} />
                      <Text style={styles.chipText}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {savingsTotal > 0 && incomeValue > 0 && (
                  <View style={styles.totalBox}>
                    <Text style={styles.totalLabel}>Ton matelas de sécurité</Text>
                    <Text style={styles.totalValue}>
                      ≈ {(savingsTotal / incomeValue).toFixed(1).replace('.', ',').replace(',0', '')} mois
                    </Text>
                  </View>
                )}

                <View style={styles.info}>
                  <Ionicons name="flash-outline" size={15} color={COLORS.blue} />
                  <Text style={styles.infoText}>
                    Création rapide : pas d’enveloppe fiscale ni de date d’ouverture ici. Tu
                    complèteras ces détails dans la fiche du compte quand tu voudras.
                  </Text>
                </View>
                <Text style={styles.fieldHint}>
                  Tu n’en as pas encore ? Passe cette étape — tu pourras les ajouter à tout moment
                  depuis l’onglet Comptes.
                </Text>
              </>
            )}

            {/* ─────────── 5. TON PREMIER RELYKA ─────────── */}
            {step === 4 && (
              <>
                <Text style={styles.eyebrow}>Ton premier Relyka</Text>
                <Text style={styles.bigNumber}>
                  ≈ {Math.round(theoretical).toLocaleString('fr-FR')} {symbol}
                </Text>
                <Text style={styles.sub}>
                  C’est ce qu’il te restera <Text style={{ fontWeight: '700', color: COLORS.text }}>en théorie</Text> à
                  la fin du mois, une fois tes charges connues couvertes.
                  <InfoDot term="relyka" size={14} />
                </Text>

                <View style={styles.recap}>
                  <View style={styles.recapRow}>
                    <Text style={styles.recapLabel}>Ce qui rentre</Text>
                    <Text style={[styles.recapValue, { color: COLORS.emerald }]}>
                      + {Math.round(incomeValue).toLocaleString('fr-FR')} {symbol}
                    </Text>
                  </View>
                  <View style={styles.recapRow}>
                    <Text style={styles.recapLabel}>Tes charges fixes</Text>
                    <Text style={[styles.recapValue, { color: COLORS.danger }]}>
                      − {Math.round(chargesTotal).toLocaleString('fr-FR')} {symbol}
                    </Text>
                  </View>
                  <View style={[styles.recapRow, styles.recapTotal]}>
                    <Text style={[styles.recapLabel, { fontWeight: '800', color: COLORS.text }]}>En théorie, il te reste</Text>
                    <Text style={[styles.recapValue, { color: COLORS.emerald, fontWeight: '800' }]}>
                      {Math.round(theoretical).toLocaleString('fr-FR')} {symbol}
                    </Text>
                  </View>
                </View>

                <View style={styles.pending}>
                  <Text style={styles.pendingTitle}>Deux choses vont encore l’affiner</Text>
                  <View style={styles.pendingRow}>
                    <Ionicons name="lock-closed-outline" size={15} color={COLORS.blue} />
                    <Text style={styles.pendingText}>
                      <Text style={{ fontWeight: '700', color: COLORS.text }}>Ta marge de sécurité </Text>
                      <InfoDot term="marge_securite" size={13} color={COLORS.blue} />
                      {'\n'}Le montant que tu veux avoir au minimum sur ton compte en fin de mois.
                      On te dira ce que tu peux utiliser avant d’y toucher.
                    </Text>
                  </View>
                  <View style={styles.pendingRow}>
                    <Ionicons name="cart-outline" size={15} color={COLORS.orange} />
                    <Text style={styles.pendingText}>
                      <Text style={{ fontWeight: '700', color: COLORS.text }}>Tes dépenses variables </Text>
                      <InfoDot term="enveloppe_variable" size={13} color={COLORS.orange} />
                      {'\n'}Courses, sorties, imprévus : on les met de côté pour ne pas te les
                      présenter comme disponibles.
                    </Text>
                  </View>
                  <Text style={styles.pendingFoot}>
                    On te posera ces deux questions dans l’app, au moment où elles auront du sens.
                    Rien n’est bloqué en attendant.
                  </Text>
                </View>
              </>
            )}

            <View style={{ height: 110 }} />
          </ScrollView>
        </Animated.View>

        {/* Barre d'action */}
        <View style={styles.footer}>
          {!!blockingMessage && (
            <View style={styles.blocker}>
              <Ionicons name="alert-circle-outline" size={14} color={COLORS.orange} />
              <Text style={styles.blockerText}>{blockingMessage}</Text>
            </View>
          )}
          {step === 0 && (
            <TouchableOpacity
              style={[styles.cta, !canNext && styles.ctaOff]}
              disabled={!canNext || !!busy}
              onPress={submitMain}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaLabel}>Créer mon compte</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
            </TouchableOpacity>
          )}
          {step === 1 && (
            <TouchableOpacity
              style={[styles.cta, !canNext && styles.ctaOff]}
              disabled={!canNext || !!busy}
              onPress={submitIncome}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaLabel}>Continuer</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
            </TouchableOpacity>
          )}
          {step === 2 && (
            <>
              <TouchableOpacity
                style={[styles.cta, !canNext && styles.ctaOff]}
                disabled={!canNext || !!busy}
                onPress={submitCharges}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaLabel}>Enregistrer mes charges</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
              </TouchableOpacity>
              {/* L'échappatoire n'existe que si RIEN n'a été commencé : une fois une ligne ajoutée,
                  il faut la compléter ou la retirer — pas créer une charge à 0 €. */}
              {charges.length === 0 && (
                <TouchableOpacity onPress={() => goTo(3)} style={styles.skip} hitSlop={8}>
                  <Text style={styles.skipText}>Je les ajouterai plus tard</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <TouchableOpacity
                style={[styles.cta, !canNext && styles.ctaOff]}
                disabled={!canNext || !!busy}
                onPress={submitAccountsAndProfile}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaLabel}>Voir mon Relyka</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
              </TouchableOpacity>
              {others.length === 0 && (
                <TouchableOpacity onPress={submitAccountsAndProfile} style={styles.skip} hitSlop={8}>
                  <Text style={styles.skipText}>Je n’en ai pas pour l’instant</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {step === 4 && (
            <TouchableOpacity
              style={styles.cta}
              onPress={() => router.replace('/(tabs)/pilotage?welcome=1' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaLabel}>Entrer dans l’app</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      <Modal visible={!!busy} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={COLORS.emerald} />
            <Text style={styles.overlayText}>{busy}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ── Champs de saisie ──────────────────────────────────────────────────────────────────────────
   Le focus se lit sur LE CHAMP ENTIER (bordure d'accent + fond légèrement teinté), jamais par un
   anneau autour de la boîte : sur web, l'anneau natif du navigateur reprend la couleur d'accent du
   système (souvent orange) et casse l'identité. Cet anneau est neutralisé dans public/index.html. */

interface FieldProps {
  styles: any;
  placeholderColor: string;
  selectionColor: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}

/** Champ texte simple (nom de compte…). */
function TextField({ styles, placeholderColor, selectionColor, ...props }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      style={[styles.input, focused && styles.inputFocus]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholderTextColor={placeholderColor}
      selectionColor={selectionColor}
    />
  );
}

/** Champ montant : la boîte entière (chiffre + symbole) s'allume à la saisie. */
function AmountField({
  styles, placeholderColor, selectionColor, symbol, ...props
}: FieldProps & { symbol: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.bigInputRow, focused && styles.bigInputRowFocus]}>
      <TextInput
        {...props}
        style={styles.bigInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={placeholderColor}
        selectionColor={selectionColor}
      />
      <Text style={styles.bigUnit}>{symbol}</Text>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1 },

    progressBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
    track: { flex: 1, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, overflow: 'hidden' },
    trackFill: { height: 4, backgroundColor: c.emerald, borderRadius: 2 },
    progressLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, minWidth: 52, textAlign: 'right' },

    content: { paddingHorizontal: 24, paddingTop: 8, gap: 14 },
    logo: { width: 68, height: 68, borderRadius: 18, alignSelf: 'center', marginBottom: 4 },
    hello: { fontSize: 26, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.4 },
    tagline: { fontSize: 14.5, color: c.emerald, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
    divider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 10 },

    eyebrow: { fontSize: 11.5, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 1 },
    h1: { fontSize: 26, fontWeight: '800', color: c.text, lineHeight: 32, letterSpacing: -0.6 },
    sub: { fontSize: 15, color: c.textSecondary, lineHeight: 22 },
    bigNumber: { fontSize: 44, fontWeight: '800', color: c.emerald, letterSpacing: -1.5, marginVertical: 2 },

    field: { gap: 9, marginTop: 10 },
    fieldLabel: { fontSize: 12.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    fieldHint: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    input: {
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.cardBorder, borderRadius: 14,
      paddingHorizontal: 15, paddingVertical: 13, fontSize: 15.5, color: c.text,
    },
    // Focus : bordure d'accent + fond teinté sur TOUTE la surface. L'épaisseur de bordure ne change
    // jamais (1.5 partout) — sinon le champ « sauterait » d'un pixel à chaque clic.
    inputFocus: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    bigInputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.emerald + '55', borderRadius: 16,
      paddingHorizontal: 18, paddingVertical: 15,
    },
    bigInputRowFocus: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    bigInput: { flex: 1, fontSize: 30, fontWeight: '800', color: c.text, padding: 0 },
    bigUnit: { fontSize: 18, fontWeight: '700', color: c.textSecondary },

    choice: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13,
    },
    choiceSel: { borderColor: c.emerald, backgroundColor: c.selected },
    choiceLabel: { fontSize: 14.5, color: c.textSecondary, lineHeight: 20 },
    choiceHint: { fontSize: 12, color: c.textSecondary, marginTop: 1 },

    dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dayChip: {
      minWidth: 44, alignItems: 'center', backgroundColor: c.card,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12,
    },
    dayChipSel: { backgroundColor: c.emerald, borderColor: c.emerald },
    dayChipText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    dayInput: { minWidth: 62, fontSize: 14, fontWeight: '700', color: c.text, textAlign: 'center' },
    dayInputFocus: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },

    /** Ligne (charge / compte) en cours de saisie — même langage visuel que les champs. */
    rowFocus: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },

    blocker: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: c.orange + '14', borderWidth: 1, borderColor: c.orange + '33',
      borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8, marginBottom: 2,
    },
    blockerText: { flex: 1, fontSize: 12, color: c.orange, lineHeight: 17 },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
    },
    chipText: { fontSize: 13, fontWeight: '600', color: c.text },

    chargeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    },
    chargeLabel: { fontSize: 14.5, fontWeight: '600', color: c.text },
    chargeInput: { width: 82, fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'right', padding: 0 },
    chargeUnit: { fontSize: 14, fontWeight: '700', color: c.textSecondary },

    acctRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    },
    acctName: { flex: 1, fontSize: 14.5, fontWeight: '600', color: c.text, padding: 0 },

    totalBox: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.emerald + '14', borderWidth: 1, borderColor: c.emerald + '3D',
      borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13,
    },
    totalLabel: { fontSize: 13.5, fontWeight: '700', color: c.emerald },
    totalValue: { fontSize: 19, fontWeight: '800', color: c.emerald },

    info: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, padding: 12,
    },
    infoText: { flex: 1, fontSize: 12.5, color: c.blue, lineHeight: 18 },

    demo: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.emerald + '12', borderRadius: 12, padding: 12,
    },
    demoText: { flex: 1, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },

    recap: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 18, padding: 16, gap: 10,
    },
    recapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recapTotal: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 10 },
    recapLabel: { fontSize: 14, color: c.textSecondary },
    recapValue: { fontSize: 16, fontWeight: '700' },

    pending: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 18, padding: 16, gap: 12,
    },
    pendingTitle: { fontSize: 14.5, fontWeight: '800', color: c.text },
    pendingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
    pendingText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    pendingFoot: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, fontStyle: 'italic' },

    footer: {
      paddingHorizontal: 24, paddingTop: 10, paddingBottom: Platform.OS === 'web' ? 20 : 12,
      backgroundColor: c.bg, gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder,
    },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 16,
    },
    ctaOff: { opacity: 0.45 },
    ctaLabel: { fontSize: 16, fontWeight: '800', color: c.bg },
    skip: { alignItems: 'center', paddingVertical: 10 },
    skipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 32 },
    overlayCard: {
      width: '100%', maxWidth: 320, backgroundColor: c.cardSolid, borderRadius: 20,
      borderWidth: 1, borderColor: c.cardBorder, padding: 26, alignItems: 'center', gap: 14,
    },
    overlayText: { fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'center' },
  });
}
