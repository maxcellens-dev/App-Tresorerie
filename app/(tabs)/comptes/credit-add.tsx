/**
 * Création d'un crédit (module Crédit, Lot C2 + raffinements).
 * Saisie des paramètres (avec calendrier pour les dates), frais détaillés, et montants ANNUELS
 * (assurance + mensualité qui peuvent évoluer chaque année). Prévisualise l'amortissement.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import CalendarWithPicker from '../../../components/transaction/CalendarWithPicker';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts } from '../../../hooks/data/useAccounts';
import { useCategories } from '../../../hooks/data/useCategories';
import CategoryPicker, { useSubCategoriesGrouped } from '../../../components/transaction/CategoryPicker';
import { useProjects } from '../../../hooks/data/useProjects';
import { useAddCredit, useCredits, useUpdateCredit } from '../../../hooks/data/useCredits';
import { useUsageGuard } from '../../../hooks/config/useUsageLimits';
import CreditCurve from '../../../components/charts/CreditCurve';
import { computeAmortization, resolvePaliers } from '../../../lib/finance/amortization';
import { todayISO, formatDateFrench } from '../../../lib/dateUtils';
import type { CreditType } from '../../../types/database';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../../lib/finance/currency';
import { sanitizeAmountInput, sanitizeRateInput } from '../../../lib/ui/amountInput';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { useReadOnlyGuard } from '../../../hooks/platform/useReadOnlyGuard';

const TYPES: { key: CreditType; label: string; icon: string }[] = [
  { key: 'immobilier', label: 'Immobilier', icon: 'home-outline' },
  { key: 'consommation', label: 'Consommation', icon: 'cart-outline' },
  { key: 'auto', label: 'Crédit auto', icon: 'car-outline' },
  { key: 'autre', label: 'Autre', icon: 'ellipsis-horizontal' },
];

// Frais COMPTÉS dans le coût du prêt (s'ajoutent aux intérêts).
// NB : avec un DIFFÉRÉ actif, « Intérêts intercalaires » n'est plus un frais : la valeur sert de montant
// RÉEL des intérêts du différé (remplace l'estimation auto) et est déjà comprise dans les intérêts.
const LOAN_FEES: { key: string; label: string }[] = [
  { key: 'fees_guarantee', label: 'Frais de garantie' },
  { key: 'fees_notary', label: 'Frais de notaire' },
  { key: 'interim_interest', label: 'Intérêts intercalaires' },
  { key: 'management_fees', label: 'Intérêts de gestion' },
];
// Frais à payer À PART (hors coût du prêt / mensualité).
const EXTRA_FEES: { key: string; label: string }[] = [
  { key: 'fees_file', label: 'Frais de dossier' },
  { key: 'fees_bank', label: 'Frais de banque' },
  { key: 'other_fees', label: 'Autres frais' },
];

// Au-delà, le calcul et le rendu de milliers d'échéances peuvent bloquer un téléphone sans
// représenter un crédit réaliste. Ces bornes sont aussi appliquées côté base (migration 198).
const MAX_CREDIT_DURATION_MONTHS = 1200;
const MAX_DEFERRAL_MONTHS = 600;

function CreditAddScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne de formulaire étroite
  const router = useRouter();
  const params = useLocalSearchParams<{ simulation?: string; id?: string; shared?: string }>();
  const editId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const addCredit = useAddCredit(user?.id);
  const { guard } = useUsageGuard(user?.id);
  const updateCredit = useUpdateCredit(user?.id);
  const { data: allCredits = [] } = useCredits(user?.id);
  const editing = editId ? allCredits.find((c) => c.id === editId) : undefined;
  const { data: accounts = [] } = useAllAccounts(user?.id);
  /* Un invité « écriture » peut corriger le crédit, mais ne doit jamais pouvoir le faire prélever
     sur son compte personnel. Il ne peut choisir que les comptes réellement partagés/joints ; le
     compte privé du propriétaire éventuellement déjà lié reste conservé (`accountId` est initialisé
     depuis le crédit et renvoyé tel quel), sans être exposé ici.

     La liste reprend EXACTEMENT la règle du serveur (migration 198 : `acct_role IN ('owner','write')`) :
     un compte partagé en CONSULTATION seule était proposé alors que la base le refuse toujours —
     l'utilisateur remplissait son formulaire pour se voir opposer une erreur au moment d'enregistrer. */
  const isCollaborator = !!editId && !!editing && editing._role !== 'owner';
  const canDebit = (a: any) => (a._role === 'owner' ? !!a.is_joint : a._role === 'write');
  const checking = accounts.filter((a) => a.type === 'checking' && (!isCollaborator || canDebit(a)));
  const { data: projects = [] } = useProjects(user?.id);
  const activeProjects = projects.filter((p) => p.status === 'active');
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data: categories = [] } = useCategories(user?.id);
  const catGroups = useSubCategoriesGrouped(categories as any, 'expense');
  const catParents = useMemo(() => categories.filter((c) => c.type === 'expense' && !c.parent_id).map((c) => ({ id: c.id, name: c.name })), [categories]);
  const [catId, setCatId] = useState('');           // mensualité
  const [insCatId, setInsCatId] = useState('');     // assurance
  const [catTouched, setCatTouched] = useState(false);
  const [insCatTouched, setInsCatTouched] = useState(false);

  const [type, setType] = useState<CreditType>('immobilier');
  // Résolution des catégories par NOM (les sous-catégories de base sont éditées via admin).
  const findCat = (names: string[]): string => {
    const nm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    // Respecte l'ORDRE de priorité des noms : on teste le 1ᵉ nom, puis le 2ᵉ, etc.
    for (const name of names) {
      const hit = categories.find((c) => c.type === 'expense' && c.parent_id && nm(c.name) === nm(name));
      if (hit) return hit.id;
    }
    return '';
  };
  // Défaut mensualité selon le type : immo → « Prêt immobilier », sinon → « Crédits (auto, consommation) ».
  const defaultCatId = useMemo(() => type === 'immobilier'
    ? findCat(['Prêt immobilier', 'Crédits (auto, consommation)', 'Crédits'])
    : findCat(['Crédits (auto, consommation)', 'Crédits']), [type, categories]);
  const defaultInsCatId = useMemo(() => findCat(['Assurance Crédit']), [categories]);
  // En création, tant que l'utilisateur n'a pas choisi manuellement, on applique le défaut (suit le type).
  useEffect(() => { if (!editing && !catTouched) setCatId(defaultCatId); }, [defaultCatId, editing, catTouched]);
  useEffect(() => { if (!editing && !insCatTouched) setInsCatId(defaultInsCatId); }, [defaultInsCatId, editing, insCatTouched]);
  const [label, setLabel] = useState('');
  const [lender, setLender] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [duration, setDuration] = useState('');
  const [insurance, setInsurance] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [insDate, setInsDate] = useState('');       // 1ʳᵉ échéance d'assurance (vide = même que remboursement)
  const [showInsCal, setShowInsCal] = useState(false);
  const [isSimulation, setIsSimulation] = useState(params.simulation === '1');
  const [fees, setFees] = useState<Record<string, string>>({});
  const [interestManual, setInterestManual] = useState('');
  // Création : sections dépliées (on guide la saisie). Édition/consultation : repliées (gagner de la place).
  const [showFees, setShowFees] = useState(!editId);
  const [showYearly, setShowYearly] = useState(false); // toggle de MODE (par année) → géré séparément
  // Éditeur de mensualité TOUJOURS ouvert (même en édition) : c'est le point d'entrée pour changer la
  // mensualité sans passer par le tableau ligne à ligne.
  const [showPayment, setShowPayment] = useState(true);
  // L'utilisateur a-t-il TOUCHÉ à la mensualité/paliers ? Si oui en édition, enregistrer RÉAPPLIQUE la
  // mensualité à tout le tableau (efface les échéances modifiées à la main qui, sinon, la masqueraient).
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [showInsurance, setShowInsurance] = useState(!editId);
  const [insYear, setInsYear] = useState<Record<number, string>>({});
  const [payYear, setPayYear] = useState<Record<number, string>>({});
  // #8b — mensualité : standard (calculée) OU semi-fixe par paliers (auto-calc d'un palier à l'autre).
  const [paymentMode, setPaymentMode] = useState<'standard' | 'paliers'>('standard');
  const [segments, setSegments] = useState<{ startYear: number; payment: string }[]>([{ startYear: 0, payment: '' }]);
  // Assurance par paliers (montant mensuel FIXE par période).
  const [insMode, setInsMode] = useState<'flat' | 'paliers'>('flat');
  const [insSegments, setInsSegments] = useState<{ startYear: number; amount: string }[]>([{ startYear: 0, amount: '' }]);
  // #3 — Différé de remboursement (décalage au départ) → intérêts intercalaires calculés automatiquement.
  //   • partiel : on paie les intérêts (intercalaires) chaque mois pendant le différé, capital plus tard ;
  //   • total « remboursés en premier » : rien payé ; les intérêts vont dans un compteur séparé (le CRD
  //     ne bouge pas) remboursé en priorité par les premières mensualités (pratique des banques FR) ;
  //   • total « capitalisés » : rien payé ; les intérêts s'ajoutent au capital.
  // Le différé s'ajoute EN TÊTE du tableau : la durée saisie reste le nb d'échéances REMBOURSÉES.
  const [deferralMonths, setDeferralMonths] = useState('');
  const [deferralType, setDeferralType] = useState<'partial' | 'total'>('partial');
  const [deferralIntMode, setDeferralIntMode] = useState<'capitalized' | 'deferred'>('deferred');
  const [showDeferral, setShowDeferral] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitLock = useSubmitLock();
  /* Consultation admin : ce crédit serait créé ou modifié sur le compte visité. */
  const roGuard = useReadOnlyGuard();

  // Édition : pré-remplir le formulaire une fois le crédit chargé.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!editing || prefilled) return;
    setType(editing.type); setLabel(editing.label); setLender(editing.lender ?? '');
    setAccountId(editing.account_id ?? null); setProjectId(editing.project_id ?? null);
    setCatId(editing.category_id ?? ''); setInsCatId(editing.insurance_category_id ?? ''); setCatTouched(true); setInsCatTouched(true);
    setPrincipal(String(editing.principal)); setRate(String(editing.rate_annual));
    setDuration(String(editing.duration_months)); setInsurance(editing.insurance_monthly ? String(editing.insurance_monthly) : '');
    setStartDate((editing.first_payment_date as string) || editing.start_date);
    if (editing.first_insurance_date) setInsDate(editing.first_insurance_date as string);
    setIsSimulation(editing.is_simulation);
    setFees({
      fees_file: String(editing.fees_file ?? ''), fees_bank: String(editing.fees_bank ?? ''), fees_notary: String(editing.fees_notary ?? ''),
      fees_guarantee: String(editing.fees_guarantee ?? ''), personal_contribution: String(editing.personal_contribution ?? ''),
      interim_interest: String(editing.interim_interest ?? ''), management_fees: String(editing.management_fees ?? ''), other_fees: String(editing.other_fees ?? ''),
    });
    if (editing.interest_total_manual != null) setInterestManual(String(editing.interest_total_manual));
    // Différé : restituer mois + type + mode d'intérêts ; ouvrir la section si un différé existe.
    if ((editing.deferral_months ?? 0) > 0) {
      setDeferralMonths(String(editing.deferral_months));
      setDeferralType((editing.deferral_type === 'total' ? 'total' : 'partial'));
      setDeferralIntMode(editing.deferral_interest_mode === 'deferred' ? 'deferred' : 'capitalized');
      setShowDeferral(true);
    }
    // Reconstruire les PALIERS depuis les montants annuels enregistrés (regroupe les années consécutives
    // de même montant en un palier) → la saisie par palier est restituée à la réouverture.
    const toSegs = (arr: any[] | null | undefined, key: 'payment' | 'amount') => {
      if (!Array.isArray(arr)) return null;
      const segs: any[] = []; let prev: number | undefined;
      arr.forEach((v, y) => { if (v == null) return; const n = Math.round(Number(v) * 100) / 100; if (n !== prev) { segs.push({ startYear: y, [key]: String(n) }); prev = n; } });
      return segs.length ? segs : null;
    };
    // Priorité aux PALIERS STOCKÉS tels quels (restitution exacte) ; sinon reconstruction heuristique.
    // On n'utilise les paliers stockés que si les montants annuels existent aussi (sinon = paliers obsolètes
    // après bascule en mode standard).
    const storedPay = Array.isArray(editing.payment_yearly) && Array.isArray(editing.payment_paliers) && editing.payment_paliers.length
      ? editing.payment_paliers.map((s: any) => ({ startYear: Number(s.startYear) || 0, payment: String(s.payment ?? '') }))
      : null;
    const storedIns = Array.isArray(editing.insurance_yearly) && Array.isArray(editing.insurance_paliers) && editing.insurance_paliers.length
      ? editing.insurance_paliers.map((s: any) => ({ startYear: Number(s.startYear) || 0, amount: String(s.amount ?? '') }))
      : null;
    const paySegs = storedPay ?? toSegs(editing.payment_yearly, 'payment');
    if (paySegs) { setSegments(paySegs as any); setPaymentMode('paliers'); }
    const insSegs = storedIns ?? toSegs(editing.insurance_yearly, 'amount');
    if (insSegs) { setInsSegments(insSegs as any); setInsMode('paliers'); }
    // Éditeur « Montants par année » : on remplit les valeurs (utile si on bascule en mode par année),
    // mais on ne l'OUVRE automatiquement que si AUCUN palier n'a été reconstruit (sinon il masque/double
    // la section paliers, donnant l'impression que les paliers ne sont pas conservés).
    if (Array.isArray(editing.insurance_yearly) || Array.isArray(editing.payment_yearly)) {
      const ins: Record<number, string> = {}; const pay: Record<number, string> = {};
      (editing.insurance_yearly ?? []).forEach((v, i) => { if (v != null) ins[i] = String(v); });
      (editing.payment_yearly ?? []).forEach((v, i) => { if (v != null) pay[i] = String(v); });
      setInsYear(ins); setPayYear(pay);
      if (!paySegs && !insSegs) setShowYearly(true);
    }
    setPrefilled(true);
  }, [editing, prefilled]);

  // Rendre VISIBLE le compte de prélèvement sélectionné (sinon il reste hors écran à droite).
  const acctScrollRef = useRef<ScrollView>(null);
  const acctPos = useRef<Record<string, number>>({});
  const scrollToAcct = (animated: boolean) => {
    if (accountId && acctPos.current[accountId] != null) acctScrollRef.current?.scrollTo({ x: Math.max(0, acctPos.current[accountId] - 40), animated });
  };
  useEffect(() => { scrollToAcct(true); }, [accountId]);

  const num = (s: string | undefined) => (s ? parseFloat(s.replace(',', '.')) : NaN);
  const numOr0 = (s: string | undefined) => { const v = num(s); return Number.isNaN(v) ? 0 : v; };
  const years = useMemo(() => { const n = parseInt(duration, 10); return n > 0 ? Math.ceil(n / 12) : 0; }, [duration]);

  // Options de différé partagées entre le solveur de paliers et l'amortissement (le stock d'intérêts
  // différés change la mensualité qui solde le prêt).
  const deferN = Math.max(0, parseInt(deferralMonths, 10) || 0);
  const deferOpts = useMemo(() => ({
    months: deferN,
    type: (deferN > 0 ? deferralType : 'none') as 'none' | 'partial' | 'total',
    interestMode: deferralIntMode,
    seed: numOr0(fees.interim_interest),
  }), [deferN, deferralType, deferralIntMode, fees.interim_interest]);

  // #8b — paliers résolus (mensualités auto-calculées d'un palier à l'autre, différé compris).
  const paliers = useMemo(() => {
    const C = num(principal), n = parseInt(duration, 10), r = num(rate);
    if (paymentMode !== 'paliers' || !C || !n || Number.isNaN(C) || Number.isNaN(n)) return null;
    return resolvePaliers(C, Number.isNaN(r) ? 0 : r, n, segments.map((s) => ({ startYear: s.startYear, payment: num(s.payment) })), deferOpts);
  }, [paymentMode, segments, principal, duration, rate, deferOpts]);

  const buildInsArray = (): (number | null)[] =>
    Array.from({ length: years }, (_, y) => { const v = num(insYear[y]); return Number.isNaN(v) ? numOr0(insurance) : v; });
  const buildPayArray = (): (number | null)[] =>
    Array.from({ length: years }, (_, y) => { const v = num(payYear[y]); return Number.isNaN(v) || v <= 0 ? null : v; });
  // Assurance par paliers : chaque année prend le montant du palier actif (montant FIXE, pas d'auto-calc).
  const buildInsFromSegments = (): (number | null)[] => {
    const sorted = [...insSegments].sort((a, b) => a.startYear - b.startYear);
    return Array.from({ length: years }, (_, y) => {
      let amt = numOr0(insurance);
      for (const s of sorted) { if (s.startYear <= y) amt = numOr0(s.amount); }
      return amt;
    });
  };
  // payment_yearly effectif : paliers (si actif) sinon l'éditeur par année.
  const effPaymentYearly = (): (number | null)[] | null =>
    paymentMode === 'paliers' && paliers ? paliers.paymentYearly : (showYearly && years > 0 ? buildPayArray() : null);
  const effInsuranceYearly = (): (number | null)[] | null =>
    insMode === 'paliers' && years > 0 ? buildInsFromSegments() : (showYearly && years > 0 ? buildInsArray() : null);

  const amort = useMemo(() => {
    const C = num(principal), n = parseInt(duration, 10), r = num(rate);
    if (!C || !n || Number.isNaN(C) || Number.isNaN(n)) return null;
    return computeAmortization({
      principal: C, rate_annual: Number.isNaN(r) ? 0 : r, duration_months: n,
      start_date: startDate, insurance_monthly: numOr0(insurance),
      insurance_yearly: effInsuranceYearly(),
      payment_yearly: effPaymentYearly(),
      deferral_months: deferN,
      deferral_type: deferOpts.type,
      deferral_interest_mode: deferralIntMode,
      interim_interest: numOr0(fees.interim_interest),
    });
  }, [principal, duration, rate, insurance, startDate, showYearly, insYear, payYear, years, paymentMode, paliers, insMode, insSegments, deferN, deferOpts, deferralIntMode, fees.interim_interest]);

  /* Les montants simulés ici (mensualité, coût total) seront prélevés sur le compte choisi : ils
     s'expriment dans SA devise dès qu'il est sélectionné. Tant qu'aucun compte n'est choisi, on
     retombe sur la devise de référence. */
  const creditCurrency = accounts.find((a) => a.id === accountId)?.currency;
  const fmt = (v: number) =>
    v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + ` ${creditCurrency ? currencySymbolFor(creditCurrency) : CURRENCY_SYMBOL}`;
  const stdPayment = amort ? amort.monthlyPayment : 0;
  // Nb d'échéances modifiées à la main (schedule_overrides) sur le crédit édité — celles qui masquent
  // la mensualité globale. Changer la mensualité et enregistrer les efface pour tout réappliquer.
  const overrideCount = editing?.schedule_overrides ? Object.keys(editing.schedule_overrides).length : 0;
  // Bascule vers une mensualité IMPOSÉE (mode paliers, un seul palier pré-rempli avec la mensualité
  // actuelle) → l'utilisateur tape ensuite le montant voulu, appliqué à toute la durée.
  const forceCustomPayment = () => {
    setPaymentMode('paliers');
    // On pré-remplit avec la mensualité calculée AU CENTIME (pas arrondie à l'euro).
    setSegments([{ startYear: 0, payment: (Math.round(stdPayment * 100) / 100).toFixed(2) }]);
    setPaymentTouched(true);
  };

  const save = async () => {
    if (roGuard.blocked()) return;
    setError(null);
    const C = num(principal), n = parseInt(duration, 10);
    if (editId && !editing) return setError("Ce crédit n'est plus accessible. Reviens à la liste et actualise-la.");
    if (!label.trim()) return setError('Donne un libellé au crédit.');
    if (!Number.isFinite(C) || C <= 0) return setError('Renseigne un capital emprunté valide.');
    if (!/^\d+$/.test(duration) || !n || n > MAX_CREDIT_DURATION_MONTHS) return setError(`La durée doit être comprise entre 1 et ${MAX_CREDIT_DURATION_MONTHS} mois.`);
    if (rate.trim() && (!Number.isFinite(num(rate)) || num(rate) < 0 || num(rate) > 100)) return setError('Le taux annuel doit être compris entre 0 et 100 %.');
    if (insurance.trim() && (!Number.isFinite(num(insurance)) || num(insurance) < 0)) return setError("L'assurance mensuelle doit être un montant positif ou nul.");
    if (deferralMonths.trim() && (!/^\d+$/.test(deferralMonths) || deferN > MAX_DEFERRAL_MONTHS)) return setError(`Le différé doit être compris entre 0 et ${MAX_DEFERRAL_MONTHS} mois.`);
    /* Le différé s'AJOUTE à la durée d'amortissement (le tableau fait `différé + durée` échéances).
       Rien ne le reliait donc à la durée du prêt : un différé de 600 mois sur un crédit de 12 mois
       passait, et produisait un échéancier qui n'a aucun sens financier — 50 ans à ne payer que des
       intérêts avant un an de remboursement. Un différé plus long que la période de remboursement
       n'existe pas comme produit : on le borne à la durée. */
    if (deferN > n) return setError(`Le différé (${deferN} mois) ne peut pas dépasser la durée de remboursement (${n} mois).`);
    const optionalAmounts = [interestManual, ...Object.values(fees), ...Object.values(insYear), ...Object.values(payYear), ...segments.map((s) => s.payment), ...insSegments.map((s) => s.amount)];
    if (optionalAmounts.some((value) => value.trim() !== '' && (!Number.isFinite(num(value)) || num(value) < 0))) {
      return setError('Chaque montant renseigné doit être un nombre positif ou nul.');
    }
    /* VERROU SYNCHRONE. `saving` est un état React : il ne désactive le bouton qu'au rendu SUIVANT,
       donc deux taps rapprochés créaient DEUX crédits identiques — deux échéanciers, deux séries de
       mensualités matérialisées, un « reste à payer » doublé. Placé après les validations, qui
       sortent sans rien écrire. */
    if (!submitLock.acquire()) return;
    setSaving(true);
    const payload: any = {
      type, label: label.trim(), lender: lender.trim() || null, account_id: accountId, project_id: projectId,
      category_id: catId || null, insurance_category_id: insCatId || null,
      principal: C, duration_months: n, rate_annual: numOr0(rate), rate_type: 'fixe',
      insurance_monthly: numOr0(insurance), start_date: startDate, first_payment_date: startDate,
      is_simulation: isSimulation,
      // #3 — Différé de remboursement (0 = aucun). Les intérêts intercalaires en découlent (calcul auto,
      // bypassable par « Intérêts intercalaires » saisis). Mode d'intérêts envoyé seulement si différé
      // (colonne migration 126 — anti « column not found » si la migration tarde).
      deferral_months: deferN,
      deferral_type: deferN > 0 ? deferralType : 'none',
      ...(deferN > 0 ? { deferral_interest_mode: deferralIntMode } : {}),
      fees_file: numOr0(fees.fees_file), fees_bank: numOr0(fees.fees_bank), fees_notary: numOr0(fees.fees_notary),
      fees_guarantee: numOr0(fees.fees_guarantee), personal_contribution: numOr0(fees.personal_contribution),
      interim_interest: numOr0(fees.interim_interest), management_fees: numOr0(fees.management_fees), other_fees: numOr0(fees.other_fees),
      insurance_yearly: effInsuranceYearly(),
      payment_yearly: effPaymentYearly(),
      // Paliers bruts (restitution exacte) — envoyés seulement en mode paliers (migration 111). Omis sinon
      // pour ne pas exiger la colonne sur les crédits sans paliers (anti « column not found »).
      ...(paymentMode === 'paliers' ? { payment_paliers: segments } : {}),
      ...(insMode === 'paliers' ? { insurance_paliers: insSegments } : {}),
      // Colonnes des migrations récentes : envoyées seulement si renseignées → l'enregistrement ne casse
      // pas si une migration tarde (107 = interest_total_manual, 109 = first_insurance_date).
      ...(insDate ? { first_insurance_date: insDate } : {}),
      ...(!Number.isNaN(num(interestManual)) ? { interest_total_manual: num(interestManual) } : {}),
      // Propagation : si la mensualité/les paliers ont été changés en édition, on efface les échéances
      // modifiées à la main du tableau (elles masqueraient la nouvelle mensualité). « Écraser & réappliquer ».
      ...(editId && paymentTouched ? { schedule_overrides: null } : {}),
    };
    /* Limite d'usage (crédits) — création uniquement.
       ⚠️ `setSaving(true)` est déjà passé plus haut : sortir ici sans le remettre à faux laissait le
       bouton « Enregistrer » désactivé et grisé POUR DE BON. L'utilisateur qui atteint sa limite
       voyait le message, fermait la modale… et ne pouvait plus rien enregistrer sans quitter
       l'écran. */
    if (!editId && !(await guard('credit'))) { submitLock.release(); setSaving(false); return; }
    try {
      if (editId) { await updateCredit.mutateAsync({ id: editId, ...payload }); router.back(); }
      else {
        /* « Partagé » choisi à la création = la dette est portée à plusieurs (migration 166), ce qui
           la place dans le récap « Crédits partagés ». Les invitations, elles, se donnent ensuite sur
           la fiche : c'est un droit d'accès, une question distincte — d'où l'ouverture du détail. */
        const created = await addCredit.mutateAsync({ ...payload, is_active: true, is_shared: params.shared === '1' });
        if (params.shared === '1' && created?.id) router.replace(`/(tabs)/comptes/credit/${created.id}` as any);
        else router.back();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Impossible d\'enregistrer.');
      setSaving(false);
      // Réessai possible après un échec. En cas de SUCCÈS on ne relâche pas : l'écran se ferme, et
      // relâcher rouvrirait la porte pendant l'animation de sortie.
      submitLock.release();
    }
  };

  return (
    <View style={styles.root}>
      <ScreenGradient />
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title={editId ? 'Modifier le crédit' : 'Nouveau crédit'} onBack={() => router.back()} />
        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBanner}><Ionicons name="alert-circle" size={16} color={COLORS.danger} /><Text style={styles.errorText}>{error}</Text></View>}

          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t.key} style={[styles.typeChip, type === t.key && styles.typeChipActive]} onPress={() => setType(t.key)}>
                <Ionicons name={t.icon as any} size={18} color={type === t.key ? COLORS.blue : COLORS.textSecondary} />
                <Text style={[styles.typeLabel, type === t.key && { color: COLORS.blue }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Libellé *</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Ex : Prêt résidence principale" placeholderTextColor={COLORS.textSecondary} />

          <Text style={styles.label}>Établissement prêteur</Text>
          <TextInput style={styles.input} value={lender} onChangeText={setLender} placeholder="Ex : Crédit Agricole" placeholderTextColor={COLORS.textSecondary} />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Capital emprunté (€) *</Text>
              <TextInput style={styles.input} value={principal} onChangeText={(v) => setPrincipal(sanitizeAmountInput(v))} keyboardType="decimal-pad" placeholder="200000" placeholderTextColor={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Durée (mois) *</Text>
              <TextInput style={styles.input} value={duration} onChangeText={(v) => setDuration(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="240" placeholderTextColor={COLORS.textSecondary} />
            </View>
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Taux annuel (%)</Text>
              <TextInput style={styles.input} value={rate} onChangeText={(v) => setRate(sanitizeRateInput(v))} keyboardType="decimal-pad" placeholder="3.5" placeholderTextColor={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Assurance (€/mois)</Text>
              <TextInput style={styles.input} value={insurance} onChangeText={(v) => setInsurance(sanitizeAmountInput(v))} keyboardType="decimal-pad" placeholder="30" placeholderTextColor={COLORS.textSecondary} />
            </View>
          </View>

          <Text style={styles.label}>Date de 1ʳᵉ échéance</Text>
          <TouchableOpacity style={[styles.input, styles.dateBtn]} onPress={() => setShowCal(true)} activeOpacity={0.7}>
            <Text style={{ color: COLORS.text, fontSize: 15 }}>{formatDateFrench(startDate)}</Text>
            <Ionicons name="calendar-outline" size={18} color={COLORS.blue} />
          </TouchableOpacity>

          {checking.length > 0 && (
            <>
              <Text style={styles.label}>Compte de prélèvement</Text>
              <ScrollView ref={acctScrollRef} horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {checking.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    onLayout={(e) => { acctPos.current[a.id] = e.nativeEvent.layout.x; if (a.id === accountId) scrollToAcct(false); }}
                    style={[styles.acctChip, accountId === a.id && styles.acctChipActive]}
                    onPress={() => setAccountId(accountId === a.id ? null : a.id)}
                  >
                    <Text style={[styles.acctChipText, accountId === a.id && { color: COLORS.blue }]}>{a.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {catGroups.length > 0 && (
            <>
              <CategoryPicker
                label="Catégorie de la mensualité"
                groups={catGroups}
                selectedCategoryId={catId}
                onSelect={(id) => { setCatId(id); setCatTouched(true); }}
                parents={catParents}
              />
              <CategoryPicker
                label="Catégorie de l'assurance"
                groups={catGroups}
                selectedCategoryId={insCatId}
                onSelect={(id) => { setInsCatId(id); setInsCatTouched(true); }}
                parents={catParents}
              />
              <Text style={styles.hint}>La mensualité et l'assurance sont comptées dans ces catégories de dépense — au prorata du % d'impact si le compte est partagé.</Text>
            </>
          )}

          {/* Affectation à un projet masquée pour le moment (peu utile). */}
          {false && activeProjects.length > 0 && (
            <>
              <Text style={styles.label}>Financer un projet (optionnel)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {activeProjects.map((p) => (
                  <TouchableOpacity key={p.id} style={[styles.acctChip, projectId === p.id && styles.acctChipActive]} onPress={() => setProjectId(projectId === p.id ? null : p.id)}>
                    <Text style={[styles.acctChipText, projectId === p.id && { color: COLORS.blue }]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* #5 — Frais & apport (repliable) : 2 groupes distincts + intérêts manuels. */}
          <TouchableOpacity style={styles.section} onPress={() => setShowFees((v) => !v)} activeOpacity={0.7}>
            <Ionicons name="receipt-outline" size={18} color={COLORS.text} />
            <Text style={styles.sectionTitle}>Frais & apport</Text>
            <Ionicons name={showFees ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {showFees && (
            <View style={{ gap: 8, marginTop: 4 }}>
              {/* Intérêts : calculés depuis le taux, bypassables manuellement. */}
              <View style={styles.feeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.feeLabel}>Intérêts (total)</Text>
                  <Text style={styles.feeSubHint}>Calculé : {amort ? fmt(amort.totalInterest) : '—'}. Laisse vide pour l'auto.</Text>
                </View>
                <TextInput style={styles.feeInput} value={interestManual} onChangeText={(v) => setInterestManual(sanitizeAmountInput(v))} keyboardType="decimal-pad" placeholder={amort ? amort.totalInterest.toFixed(2) : '0'} placeholderTextColor={COLORS.textSecondary} />
              </View>

              <Text style={styles.feeGroup}>Intérêts & frais du prêt <Text style={styles.feeGroupHint}>(comptés dans le coût du prêt)</Text></Text>
              {/* Avec un différé, les intercalaires se saisissent dans la section « Différé » (ils sont
                  compris dans les intérêts, pas un frais en plus). */}
              {LOAN_FEES.filter((f) => !(deferN > 0 && f.key === 'interim_interest')).map((f) => (
                <View key={f.key} style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{f.label}</Text>
                  <TextInput style={styles.feeInput} value={fees[f.key] ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, [f.key]: sanitizeAmountInput(v) }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
                </View>
              ))}

              <Text style={styles.feeGroup}>Frais à payer à part <Text style={styles.feeGroupHint}>(hors coût du prêt)</Text></Text>
              {EXTRA_FEES.map((f) => (
                <View key={f.key} style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{f.label}</Text>
                  <TextInput style={styles.feeInput} value={fees[f.key] ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, [f.key]: sanitizeAmountInput(v) }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
                </View>
              ))}

              <Text style={styles.feeGroup}>Apport</Text>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Apport personnel</Text>
                <TextInput style={styles.feeInput} value={fees.personal_contribution ?? ''} onChangeText={(v) => setFees((p) => ({ ...p, personal_contribution: sanitizeAmountInput(v) }))} keyboardType="decimal-pad" placeholder="0 €" placeholderTextColor={COLORS.textSecondary} />
              </View>
            </View>
          )}

          {/* #8b — Mensualité : standard (calculée) OU semi-fixe par paliers (auto-calculés). */}
          {years > 0 && (
            <>
              <TouchableOpacity style={styles.section} onPress={() => setShowPayment((v) => !v)} activeOpacity={0.7}>
                <Ionicons name="trending-up-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Mensualité</Text>
                <Ionicons name={showPayment ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showPayment && (<>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {([['standard', 'Calculée'], ['paliers', 'Par paliers']] as const).map(([m, lbl]) => (
                  <TouchableOpacity key={m} style={[styles.modeChip, paymentMode === m && styles.modeChipActive]} onPress={() => { setPaymentMode(m); setPaymentTouched(true); }}>
                    <Text style={[styles.modeText, paymentMode === m && { color: COLORS.blue }]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Mode CALCULÉ : on affiche la mensualité calculée + un raccourci pour en imposer une autre. */}
              {paymentMode === 'standard' && (
                <View style={{ marginBottom: 10 }}>
                  <View style={styles.calcRow}>
                    <Text style={styles.calcLabel}>Mensualité calculée (hors assurance)</Text>
                    <Text style={styles.calcValue}>{fmt(stdPayment)}</Text>
                  </View>
                  <TouchableOpacity style={styles.forceLink} onPress={forceCustomPayment} activeOpacity={0.7}>
                    <Ionicons name="create-outline" size={15} color={COLORS.blue} />
                    <Text style={styles.forceLinkText}>Imposer une autre mensualité</Text>
                  </TouchableOpacity>
                </View>
              )}
              {paymentMode === 'paliers' && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.hint}>Mensualité FIXE par période. Laisse une mensualité vide → calcul auto pour solder le prêt sur la durée restante.</Text>
                  {segments.map((s, i) => (
                    <View key={i} style={styles.segRow}>
                      <Text style={styles.segFrom}>À partir de l'an</Text>
                      <TextInput
                        style={styles.segYear} keyboardType="number-pad"
                        value={i === 0 ? '1' : String(s.startYear + 1)} editable={i !== 0}
                        onChangeText={(v) => { const y = Math.max(1, parseInt(v, 10) || 1) - 1; setSegments((p) => p.map((seg, j) => j === i ? { ...seg, startYear: y } : seg)); setPaymentTouched(true); }}
                      />
                      <TextInput
                        style={styles.segPay} keyboardType="decimal-pad"
                        value={s.payment} onChangeText={(v) => { setSegments((p) => p.map((seg, j) => j === i ? { ...seg, payment: sanitizeAmountInput(v) } : seg)); setPaymentTouched(true); }}
                        placeholder={paliers ? String(paliers.resolved[i] ?? '') + ' (auto)' : 'auto'} placeholderTextColor={COLORS.textSecondary}
                      />
                      {i > 0 && (
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => { setSegments((p) => p.filter((_, j) => j !== i)); setPaymentTouched(true); }}><Ionicons name="close-circle" size={20} color={COLORS.danger} /></TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.segAdd} onPress={() => { setSegments((p) => [...p, { startYear: Math.min(years - 1, (p[p.length - 1]?.startYear ?? 0) + 1), payment: '' }]); setPaymentTouched(true); }}>
                    <Ionicons name="add" size={16} color={COLORS.blue} />
                    <Text style={styles.segAddText}>Ajouter un palier</Text>
                  </TouchableOpacity>
                </View>
              )}
              {/* Avertissement : le tableau a des échéances modifiées à la main qui MASQUENT la mensualité.
                  En changeant la mensualité, l'enregistrement les efface pour tout réappliquer. */}
              {overrideCount > 0 && (
                <View style={[styles.overrideWarn, paymentTouched && { borderColor: COLORS.blue + '88', backgroundColor: COLORS.blue + '12' }]}>
                  <Ionicons name={paymentTouched ? 'sync-outline' : 'information-circle-outline'} size={16} color={paymentTouched ? COLORS.blue : COLORS.textSecondary} />
                  <Text style={styles.overrideWarnText}>
                    {paymentTouched
                      ? `${overrideCount} échéance${overrideCount > 1 ? 's' : ''} modifiée${overrideCount > 1 ? 's' : ''} à la main ser${overrideCount > 1 ? 'ont' : 'a'} effacée${overrideCount > 1 ? 's' : ''} : la nouvelle mensualité s'appliquera à tout le tableau.`
                      : `${overrideCount} échéance${overrideCount > 1 ? 's' : ''} du tableau ${overrideCount > 1 ? 'ont' : 'a'} été modifiée${overrideCount > 1 ? 's' : ''} à la main. Change la mensualité ci-dessus pour la réappliquer à tout le tableau.`}
                  </Text>
                </View>
              )}
              </>)}

              {/* #3 — Différé de remboursement → intérêts intercalaires calculés automatiquement. */}
              <TouchableOpacity style={styles.section} onPress={() => setShowDeferral((v) => !v)} activeOpacity={0.7}>
                <Ionicons name="hourglass-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Différé de remboursement</Text>
                <Ionicons name={showDeferral ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showDeferral && (<>
                <Text style={styles.hint}>
                  Si le 1ᵉʳ remboursement du capital est décalé (ex. construction, franchise), la banque facture
                  des intérêts « intercalaires » sur la période. Les mois de différé s'ajoutent EN TÊTE du
                  tableau : la durée saisie plus haut reste le nombre d'échéances remboursées. La date de 1ʳᵉ
                  échéance = la 1ʳᵉ ligne du tableau (début du différé).
                </Text>
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Durée du différé (mois)</Text>
                    <TextInput
                      style={styles.input} value={deferralMonths} onChangeText={(v) => setDeferralMonths(v.replace(/\D/g, '').slice(0, 3))}
                      keyboardType="number-pad" placeholder="0" placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                  <View style={{ flex: 1.4 }}>
                    <Text style={styles.label}>Type</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([['partial', 'Partiel'], ['total', 'Total']] as const).map(([m, lbl]) => (
                        <TouchableOpacity key={m} style={[styles.modeChip, deferralType === m && styles.modeChipActive]} onPress={() => setDeferralType(m)}>
                          <Text style={[styles.modeText, deferralType === m && { color: COLORS.blue }]}>{lbl}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
                {deferralType === 'total' && (
                  <>
                    <Text style={styles.label}>Intérêts du différé</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([['deferred', 'Remboursés en premier'], ['capitalized', 'Capitalisés']] as const).map(([m, lbl]) => (
                        <TouchableOpacity key={m} style={[styles.modeChip, deferralIntMode === m && styles.modeChipActive]} onPress={() => setDeferralIntMode(m)}>
                          <Text style={[styles.modeText, deferralIntMode === m && { color: COLORS.blue }]}>{lbl}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                <Text style={styles.hint}>
                  {deferralType === 'partial'
                    ? 'Partiel : tu paies les intérêts chaque mois pendant le différé (le capital ne baisse pas encore).'
                    : deferralIntMode === 'deferred'
                      ? 'Total, remboursés en premier : tu ne paies rien pendant le différé ; les intérêts vont dans un compteur séparé (le capital restant dû ne bouge pas), remboursé en priorité par les premières mensualités avant d\'amortir le capital. C\'est ce que font la plupart des banques (colonne « intérêts différés » de leur échéancier).'
                      : 'Total, capitalisés : tu ne paies rien pendant le différé ; les intérêts s\'ajoutent au capital (qui augmente).'}
                </Text>
                {deferN > 0 && (
                  <View style={styles.feeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.feeLabel}>Intérêts intercalaires réels (€)</Text>
                      <Text style={styles.feeSubHint}>Montant du relevé banque. Vide = estimation auto — utile si le capital est débloqué par tranches (l'estimation sur le capital total serait trop haute).</Text>
                    </View>
                    <TextInput
                      style={styles.feeInput} value={fees.interim_interest ?? ''}
                      onChangeText={(v) => setFees((p) => ({ ...p, interim_interest: sanitizeAmountInput(v) }))}
                      keyboardType="decimal-pad" placeholder="auto" placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                )}
                {deferN > 0 && amort && (
                  <View style={[styles.overrideWarn, { borderColor: COLORS.blue + '88', backgroundColor: COLORS.blue + '12' }]}>
                    <Ionicons name="calculator-outline" size={16} color={COLORS.blue} />
                    <Text style={styles.overrideWarnText}>
                      Intérêts intercalaires {numOr0(fees.interim_interest) > 0 ? 'saisis' : 'estimés'} : <Text style={{ fontWeight: '800' }}>{fmt(amort.deferralInterest)}</Text> sur {deferN} mois
                      ({deferralType === 'partial' ? 'payés pendant le différé' : deferralIntMode === 'deferred' ? 'remboursés en premier par les mensualités' : 'ajoutés au capital'}).
                      Le tableau ({deferN} + {parseInt(duration, 10) || 0} échéances) est recalculé automatiquement ; chaque échéance reste ajustable à la main.
                    </Text>
                  </View>
                )}
              </>)}

              {/* Assurance : fixe OU par paliers (montant mensuel fixe par période). */}
              <TouchableOpacity style={styles.section} onPress={() => setShowInsurance((v) => !v)} activeOpacity={0.7}>
                <Ionicons name="shield-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Assurance</Text>
                <Ionicons name={showInsurance ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showInsurance && (<>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {([['flat', 'Fixe'], ['paliers', 'Par paliers']] as const).map(([m, lbl]) => (
                  <TouchableOpacity key={m} style={[styles.modeChip, insMode === m && styles.modeChipActive]} onPress={() => setInsMode(m)}>
                    <Text style={[styles.modeText, insMode === m && { color: COLORS.blue }]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Date de 1ʳᵉ échéance d'assurance (peut différer du remboursement). */}
              <Text style={styles.label}>1ʳᵉ échéance d'assurance</Text>
              <TouchableOpacity style={[styles.input, styles.dateBtn]} onPress={() => setShowInsCal(true)} activeOpacity={0.7}>
                <Text style={{ color: insDate ? COLORS.text : COLORS.textSecondary, fontSize: 15 }}>
                  {insDate ? formatDateFrench(insDate) : `Même que le remboursement (${formatDateFrench(startDate)})`}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={COLORS.blue} />
              </TouchableOpacity>
              {insMode === 'paliers' && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.hint}>Assurance mensuelle FIXE par période (vide = montant « Assurance (€/mois) » saisi plus haut).</Text>
                  {insSegments.map((s, i) => (
                    <View key={i} style={styles.segRow}>
                      <Text style={styles.segFrom}>À partir de l'an</Text>
                      <TextInput
                        style={styles.segYear} keyboardType="number-pad"
                        value={i === 0 ? '1' : String(s.startYear + 1)} editable={i !== 0}
                        onChangeText={(v) => { const y = Math.max(1, parseInt(v, 10) || 1) - 1; setInsSegments((p) => p.map((seg, j) => j === i ? { ...seg, startYear: y } : seg)); }}
                      />
                      <TextInput
                        style={styles.segPay} keyboardType="decimal-pad"
                        value={s.amount} onChangeText={(v) => setInsSegments((p) => p.map((seg, j) => j === i ? { ...seg, amount: sanitizeAmountInput(v) } : seg))}
                        placeholder={insurance || '0'} placeholderTextColor={COLORS.textSecondary}
                      />
                      {i > 0 && (
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setInsSegments((p) => p.filter((_, j) => j !== i))}><Ionicons name="close-circle" size={20} color={COLORS.danger} /></TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.segAdd} onPress={() => setInsSegments((p) => [...p, { startYear: Math.min(years - 1, (p[p.length - 1]?.startYear ?? 0) + 1), amount: '' }])}>
                    <Ionicons name="add" size={16} color={COLORS.blue} />
                    <Text style={styles.segAddText}>Ajouter un palier</Text>
                  </TouchableOpacity>
                </View>
              )}
              </>)}

              <TouchableOpacity style={styles.section} onPress={() => setShowYearly((v) => !v)} activeOpacity={0.7}>
                <Ionicons name="calendar-number-outline" size={18} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Montants par année ({years} ans)</Text>
                <Ionicons name={showYearly ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showYearly && (
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.hint}>Vide = valeur standard (mensualité calculée, assurance ci-dessus). Renseigne pour faire varier une année.</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                    <View>
                      <View style={[styles.yRow, { borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder }]}>
                        <Text style={[styles.yHead, { width: 55 }]}>Année</Text>
                        <Text style={[styles.yHead, { width: 140 }]}>Mensualité</Text>
                        <Text style={[styles.yHead, { width: 140 }]}>Assurance</Text>
                      </View>
                      {Array.from({ length: years }, (_, y) => (
                        <View key={y} style={styles.yRow}>
                          <Text style={[styles.yYear, { width: 55 }]}>{y + 1}</Text>
                          <TextInput style={[styles.yInput, { width: 140 }]} value={payYear[y] ?? ''} onChangeText={(v) => setPayYear((p) => ({ ...p, [y]: sanitizeAmountInput(v) }))} keyboardType="decimal-pad" placeholder={stdPayment ? stdPayment.toFixed(2) : '—'} placeholderTextColor={COLORS.textSecondary} />
                          <TextInput style={[styles.yInput, { width: 140 }]} value={insYear[y] ?? ''} onChangeText={(v) => setInsYear((p) => ({ ...p, [y]: sanitizeAmountInput(v) }))} keyboardType="decimal-pad" placeholder={insurance || '0'} placeholderTextColor={COLORS.textSecondary} />
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
            </>
          )}

          {/* Bascule « Simulation » : PROPRIÉTAIRE uniquement. Repasser un crédit en simulation le
              retire de la projection et de la trésorerie de tous les participants — c'est un
              archivage déguisé, au même titre que « Désactiver ». Le verrou est en base
              (migration 198) ; on évite ici de proposer une action qui serait refusée. */}
          {!isCollaborator && (
          <TouchableOpacity style={styles.simRow} onPress={() => setIsSimulation((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={isSimulation ? 'flask' : 'flask-outline'} size={20} color={isSimulation ? COLORS.orange : COLORS.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.simLabel}>Simulation</Text>
              <Text style={styles.simHint}>Scénario non signé. Activable → compté dans projection/trésorerie.</Text>
            </View>
            <View style={[styles.check, isSimulation && { backgroundColor: COLORS.orange, borderColor: COLORS.orange }]}>{isSimulation && <Ionicons name="checkmark" size={14} color={COLORS.bg} />}</View>
          </TouchableOpacity>
          )}

          {amort && (() => {
            // #5 — décomposition des coûts. Avec un différé, les intercalaires sont DÉJÀ dans les
            // intérêts calculés → on ne les recompte pas comme frais (anti double-comptage).
            const interest = !Number.isNaN(num(interestManual)) ? num(interestManual) : amort.totalInterest;
            const loanFees = LOAN_FEES.reduce((s, f) => s + (deferN > 0 && f.key === 'interim_interest' ? 0 : numOr0(fees[f.key])), 0);
            const extraFees = EXTRA_FEES.reduce((s, f) => s + numOr0(fees[f.key]), 0);
            const coutPret = interest + loanFees;                          // constitue la mensualité (hors assurance)
            const coutTotal = coutPret + amort.totalInsurance + extraFees; // 100% des coûts
            return (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>Estimation</Text>
                <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (hors assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyPayment)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Mensualité (1ʳᵉ année, avec assurance)</Text><Text style={styles.previewV}>{fmt(amort.monthlyWithInsurance)}</Text></View>
                <View style={[styles.previewRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.cardBorder, paddingTop: 8, marginTop: 2 }]}><Text style={styles.previewK}>Intérêts{!Number.isNaN(num(interestManual)) ? ' (manuel)' : ''}</Text><Text style={styles.previewV}>{fmt(interest)}</Text></View>
                {deferN > 0 && amort.deferralInterest > 0 && Number.isNaN(num(interestManual)) && (
                  <View style={styles.previewRow}><Text style={[styles.previewK, { paddingLeft: 12 }]}>↳ dont intérêts intercalaires (différé)</Text><Text style={styles.previewV}>{fmt(amort.deferralInterest)}</Text></View>
                )}
                <View style={styles.previewRow}><Text style={styles.previewK}>Frais (dossier, garantie, notaire…)</Text><Text style={styles.previewV}>{fmt(loanFees + extraFees)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Coût du prêt (intérêts + frais du prêt)</Text><Text style={styles.previewV}>{fmt(coutPret)}</Text></View>
                <View style={styles.previewRow}><Text style={styles.previewK}>Coût total (tout compris)</Text><Text style={[styles.previewV, { color: COLORS.danger }]}>{fmt(coutTotal)}</Text></View>
              </View>
            );
          })()}

          {/* Courbe de remboursement (capital vs intérêts + CRD) — se met à jour en direct. */}
          {amort && amort.schedule.length > 1 && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>Courbe de remboursement</Text>
              <CreditCurve schedule={amort.schedule} colors={COLORS} principal={num(principal) || 0} />
            </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.saveLabel}>{editId ? 'Enregistrer les modifications' : 'Enregistrer le crédit'}</Text>}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* Calendrier (date de déblocage) */}
      <Modal visible={showCal} transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
        <View style={styles.calOverlay}>
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <TouchableOpacity onPress={() => setShowCal(false)}><Text style={{ color: COLORS.emerald, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
              <Text style={{ fontWeight: '700', color: COLORS.text }}>Date de 1ʳᵉ échéance</Text>
              <View style={{ width: 50 }} />
            </View>
            <CalendarWithPicker
              current={startDate}
              maxDate="2060-12-31"
              onDayPress={(day: any) => { setStartDate(day.dateString); setShowCal(false); }}
              markedDates={{ [startDate]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#fff' } }}
              accentColor={COLORS.blue}
            />
          </View>
        </View>
      </Modal>

      {/* Calendrier (1ʳᵉ échéance d'assurance) */}
      <Modal visible={showInsCal} transparent animationType="fade" onRequestClose={() => setShowInsCal(false)}>
        <View style={styles.calOverlay}>
          <View style={styles.calCard}>
            <View style={styles.calHead}>
              <TouchableOpacity onPress={() => { setInsDate(''); setShowInsCal(false); }}><Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>Réinit.</Text></TouchableOpacity>
              <Text style={{ fontWeight: '700', color: COLORS.text }}>1ʳᵉ échéance d'assurance</Text>
              <TouchableOpacity onPress={() => setShowInsCal(false)}><Text style={{ color: COLORS.emerald, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={insDate || startDate}
              maxDate="2060-12-31"
              onDayPress={(day: any) => { setInsDate(day.dateString); setShowInsCal(false); }}
              markedDates={{ [insDate || startDate]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#fff' } }}
              accentColor={COLORS.blue}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.danger + '14', borderWidth: 1, borderColor: c.danger + '44', borderRadius: 12, padding: 12, marginBottom: 12 },
    errorText: { color: c.danger, fontSize: 13, flex: 1 },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 12 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text },
    dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    row2: { flexDirection: 'row', gap: 12 },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    typeChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    typeLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    acctChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    acctChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    acctChipText: { fontSize: 13, fontWeight: '600', color: c.text },
    section: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    sectionTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: c.text },
    feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    feeLabel: { flex: 1, fontSize: 13.5, color: c.text },
    feeSubHint: { fontSize: 10.5, color: c.textSecondary, marginTop: 1 },
    feeGroup: { fontSize: 12, fontWeight: '800', color: c.text, marginTop: 8 },
    feeGroupHint: { fontSize: 11, fontWeight: '500', color: c.textSecondary },
    modeChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    modeChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    modeText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    segRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    segFrom: { fontSize: 12.5, color: c.textSecondary },
    segYear: { width: 46, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingVertical: 6, fontSize: 13.5, color: c.text, textAlign: 'center' },
    segPay: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13.5, color: c.text, textAlign: 'right' },
    segAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    segAddText: { color: c.blue, fontWeight: '700', fontSize: 13 },
    calcRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    calcLabel: { fontSize: 12.5, color: c.textSecondary, flex: 1 },
    calcValue: { fontSize: 15, fontWeight: '800', color: c.text },
    forceLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' },
    forceLinkText: { color: c.blue, fontWeight: '700', fontSize: 13 },
    overrideWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4, marginBottom: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    overrideWarnText: { flex: 1, fontSize: 12, color: c.text, lineHeight: 16 },
    feeInput: { width: 110, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: c.text, textAlign: 'right' },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 8, lineHeight: 16 },
    yRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
    yHead: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
    yYear: { fontSize: 13, fontWeight: '700', color: c.text },
    yInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13.5, color: c.text, textAlign: 'right' },
    simRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginTop: 16 },
    simLabel: { fontSize: 14.5, fontWeight: '700', color: c.text },
    simHint: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    preview: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, gap: 8 },
    previewTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    previewK: { fontSize: 13, color: c.textSecondary, flex: 1 },
    previewV: { fontSize: 14, fontWeight: '700', color: c.text },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
    saveLabel: { color: c.onAccent, fontSize: 15, fontWeight: '800' },
    calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 18 },
    calCard: { backgroundColor: c.cardSolid ?? c.card, borderRadius: 18, padding: 12 },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 8 },
  });
}

/* OUVERTURE INSTANTANÉE : silhouette de page pendant le montage du corps (cf. useDeferredMount). */
export default withDeferredMount(CreditAddScreen);
