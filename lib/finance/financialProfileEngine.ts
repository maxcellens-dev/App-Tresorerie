/**
 * Moteur de profils financiers P1-P5
 * ────────────────────────────────────
 * • Calcul du profil initial via le questionnaire
 * • Évaluation automatique mensuelle (montée/descente)
 * • Règles exceptionnelles (chute de revenus)
 */

import type { FinancialProfileId } from '../../types/database';
import { computeSecurityCushion } from './securityCushion';

// ── Référentiel des profils ────────────────────────────────────

export const PROFILE_INFO: Record<FinancialProfileId, {
  name: string;
  emoji: string;
  tier: string;
  description: string;
  color: string;
}> = {
  P1: {
    name: 'Premiers repères',
    emoji: '🌱',
    tier: 'Épargne critique',
    description: 'Structure tes finances. L\'objectif prioritaire est de constituer un premier matelas de sécurité.',
    color: '#ef4444',
  },
  P2: {
    name: 'Réserve à construire',
    emoji: '🌿',
    tier: 'Épargne à renforcer',
    description: 'Les bases sont posées. Renforce ta réserve de sécurité pour couvrir 3 mois de revenus.',
    color: '#f59e0b',
  },
  P3: {
    name: 'Stabilité à améliorer',
    emoji: '⚖️',
    tier: 'Stabilité à améliorer',
    description: 'Ta situation est stable. Commence à faire travailler ton argent au-delà de l\'épargne pure.',
    color: '#3b82f6',
  },
  P4: {
    name: 'Bonne dynamique',
    emoji: '🚀',
    tier: 'Bonne dynamique',
    description: 'Ta réserve est solide et tu investisses régulièrement. L\'investissement prend une place croissante.',
    color: '#8b5cf6',
  },
  P5: {
    name: 'Patrimoine en développement',
    emoji: '🎯',
    tier: 'Confortable',
    description: 'Maturité financière remarquable. L\'objectif est d\'optimiser et faire croître ton patrimoine.',
    color: '#34d399',
  },
};

export const PROFILE_ALLOCATIONS: Record<FinancialProfileId, {
  save: number; invest: number; enjoy: number; keep: number;
}> = {
  P1: { save: 60, invest:  0, enjoy: 10, keep: 30 },
  P2: { save: 40, invest: 10, enjoy: 20, keep: 30 },
  P3: { save: 25, invest: 25, enjoy: 20, keep: 30 },
  P4: { save: 10, invest: 40, enjoy: 25, keep: 25 },
  P5: { save:  0, invest: 65, enjoy: 25, keep: 10 },
};

// Correspondance profil → tier (pour les paliers d'allocation en DB)
export const PROFILE_TO_TIER: Record<FinancialProfileId, 'critical' | 'below_optimal' | 'healthy' | 'p4_dynamic' | 'comfortable'> = {
  P1: 'critical',
  P2: 'below_optimal',
  P3: 'healthy',
  P4: 'p4_dynamic',
  P5: 'comfortable',
};

// ── Questionnaire — options ───────────────────────────────────

export const Q1_OPTIONS = [
  'Salaire fixe (Mensuel)',
  'Revenu Freelance / Indépendant (Aléatoire)',
  'Retraite (Mensuel)',
  'Loyers et Revenus immobiliers (Mensuel)',
  'Dividendes (Annuel / Ponctuel)',
  'Chômage et Allocations (Mensuel / Temporaire)',
] as const;

export const Q2_OPTIONS = [
  'Tous les mois à date fixe (+/- 5 jours)',
  'Tous les mois à des dates variables',
  'Une ou plusieurs fois par an de manière ponctuelle',
  'De manière totalement imprévisible',
] as const;

export const Q3_OPTIONS = [
  'Moins de 1 500 €',
  'De 1 500 € à 2 500 €',
  'De 2 500 € à 4 000 €',
  'Plus de 4 000 €',
] as const;

export const Q4_OPTIONS = [
  'Rien, je finis souvent le mois à découvert',
  "J'ai de quoi vivre sans trop me priver, mais je n'épargne pas",
  'Une somme que je mets volontairement de côté chaque mois',
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
] as const;

export const Q5_OPTIONS = [
  "Moins d'un mois",
  '1 à 3 mois',
  '3 à 6 mois',
  'Plus de 6 mois',
] as const;

export const Q6_OPTIONS = [
  '0 %',
  'Moins de 10 %',
  'Entre 10 % et 20 %',
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
  'Je ne sais pas',
] as const;

export const Q7_OPTIONS = [
  'Stabiliser mon budget',
  'Mettre de côté',
  'Financer un projet précis à court ou moyen terme',
  'Commencer à investir',
  'Savoir combien épargner et/ou investir',
  'Connaître mon budget plaisir disponible sans culpabiliser',
  'Suivre simplement mes finances',
] as const;

export interface QuestionnaireAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  /** @deprecated Aucun calcul ne lit cette réponse — conservée pour les comptes existants. */
  q7: string;
  /** Montant minimum conservé sur les comptes courants. Chaîne numérique ou '' pour "je ne sais pas" (→ 0). */
  q8: string;
  /** Estimation hebdomadaire des dépenses variables (€/semaine). Chaîne numérique ou '' (→ 0). */
  q9: string;
}

/** Convertit la réponse Q8 en montant numérique. '' ou "je ne sais pas" → 0. */
export function safetyMarginFromQ8(q8: string): number {
  if (!q8 || q8.toLowerCase().includes('sais pas')) return 0;
  const v = parseFloat(q8.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Montant hebdomadaire variable (€/semaine) → € net numérique. '' → 0.
 *  Question 4 du questionnaire (« Dépenses variables hebdo »), stockée en base dans le champ `q9`. */
export function weeklyVariableFromQ9(q9: string): number {
  if (!q9) return 0;
  const v = parseFloat(q9.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Facteur de conversion hebdomadaire → mensuel (52 semaines / 12 mois). */
export const WEEKS_PER_MONTH = 4.33;

/** Revenu mensuel REPRÉSENTATIF d'une tranche Q3 (borne basse prudente de la tranche). */
function representativeIncome(q3: string): number {
  const i = Q3_OPTIONS.indexOf(q3 as any);
  // Bornes basses (prudentes) : <1500→1200, 1500-2500→1800, 2500-4000→2800, >4000→4200.
  return [1200, 1800, 2800, 4200][i] ?? 1800;
}

/**
 * Estimation AUTOMATIQUE des dépenses variables hebdomadaires (€/semaine) quand l'utilisateur
 * ne la renseigne pas (ex. questionnaire passé). On prend ~35 % du revenu mensuel en variable
 * (courses + loisirs), ce qui donne un profil PRUDENT (on ne suppose pas 0 € de dépenses).
 */
export function estimateWeeklyVariable(q3: string): number {
  const monthlyVariable = representativeIncome(q3) * 0.35;
  return Math.round(monthlyVariable / WEEKS_PER_MONTH);
}

/** Estimation mensuelle des dépenses variables à partir de la réponse hebdo Q9. */
export function monthlyVariableFromQ9(q9: string): number {
  return weeklyVariableFromQ9(q9) * WEEKS_PER_MONTH;
}

// ── q5 DÉRIVÉE DES DONNÉES RÉELLES ────────────────────────────
//
// q5 (« si tes revenus s'arrêtaient demain, combien de temps tiendrais-tu ? ») est EXACTEMENT la
// définition du matelas de sécurité : épargne disponible ÷ revenu mensuel (lib/securityCushion).
// Dès que l'utilisateur a saisi ses comptes, l'app le SAIT — plus fiable qu'une auto-évaluation.
// On ne modifie pas le moteur de profils : on lui fournit la même réponse, mesurée au lieu d'être
// déclarée, et on la recalcule à chaque fois que les données bougent (cf. useLiveProfileSync).

/** Tranche Q5 correspondant à un nombre de mois de sécurité. `null` → tranche la plus basse. */
export function q5FromSecurityMonths(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return Q5_OPTIONS[0];
  if (months < 1) return Q5_OPTIONS[0];
  if (months < 3) return Q5_OPTIONS[1];
  if (months < 6) return Q5_OPTIONS[2];
  return Q5_OPTIONS[3];
}

/** Tranche Q5 déduite de l'épargne disponible et du revenu mensuel de référence. */
export function deriveQ5(availableSavings: number, monthlyIncome: number): string {
  const cushion = computeSecurityCushion({
    availableSavings,
    avgMonthlyIncome: monthlyIncome > 0 ? monthlyIncome : 0,
  });
  return q5FromSecurityMonths(cushion.months);
}

/** Tranche Q3 (revenu) correspondant à un montant mensuel net saisi. */
export function q3FromMonthlyIncome(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return Q3_OPTIONS[0];
  if (amount < 1500) return Q3_OPTIONS[0];
  if (amount < 2500) return Q3_OPTIONS[1];
  if (amount < 4000) return Q3_OPTIONS[2];
  return Q3_OPTIONS[3];
}

/**
 * RÉPONSES NEUTRES pour les questions pas encore posées (profil provisoire).
 *
 * ⚠️ Surtout PAS « la première option de chaque question », qui était l'ancien repli du bouton
 * « Passer le questionnaire » : la 1ʳᵉ option de q4 est « je finis souvent à découvert », qui
 * déclenche un `return 'P1'` immédiat. Tout utilisateur ayant sauté le questionnaire se retrouvait
 * donc classé « Épargne critique », investissement à 0 %, quelles que soient ses autres réponses.
 * Neutre = le cas médian, qui laisse q5 (mesurée) décider du niveau.
 */
export const NEUTRAL_ANSWERS: Readonly<Pick<QuestionnaireAnswers, 'q4' | 'q6'>> = {
  q4: Q4_OPTIONS[1],   // « J'ai de quoi vivre sans trop me priver, mais je n'épargne pas »
  q6: Q6_OPTIONS[6],   // « Je ne sais pas »
};

// ── Détection revenu irrégulier ───────────────────────────────

const IRREGULAR_INCOME_TYPES = new Set([
  'Revenu Freelance / Indépendant (Aléatoire)',
  'Dividendes (Annuel / Ponctuel)',
]);

/**
 * Irrégulier seulement si TOUS les types de revenus sélectionnés sont irréguliers
 * (logique "meilleure réponse" : si le profil a aussi un salaire fixe, il bénéficie
 * de la régularité de ce revenu pour la détermination du profil).
 */
export function detectIrregularIncome(q1: string, q2: string): boolean {
  const q1Values = q1.split('|').filter(Boolean);
  const allIrregular = q1Values.length > 0 && q1Values.every((v) => IRREGULAR_INCOME_TYPES.has(v));
  return allIrregular || q2 === 'De manière totalement imprévisible';
}

// ── Jeux de valeurs pour la matrice ──────────────────────────

const Q6_HIGH = new Set([
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
]);

const Q6_MID = new Set([
  'Entre 10 % et 20 %',
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
]);

const Q4_INVEST = new Set([
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
]);

const Q4_SAVING = new Set([
  'Une somme que je mets volontairement de côté chaque mois',
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
]);

const Q4_MINIMAL = new Set([
  "J'ai de quoi vivre sans trop me priver, mais je n'épargne pas",
]);

// ── Calcul du profil initial ──────────────────────────────────

/**
 * Retourne le profil P1-P5 selon la matrice du questionnaire.
 * Évaluation du plus élevé (P5) au plus bas (P1).
 */
/* ── LE PROFIL, À PARTIR DES SEULES DONNÉES RÉELLES ────────────────────────────────────────────
 *
 * Plus aucune réponse déclarée n'entre dans le calcul : ni questionnaire d'accueil, ni « micro-
 * questions ». Trois mesures suffisent, toutes issues de ce que l'utilisateur a réellement saisi.
 * Conséquence directe : dès qu'il renseigne la dernière donnée manquante (son revenu), son profil
 * apparaît — et tant qu'il manque quelque chose, il reste P1, le profil le plus prudent.
 *
 * La matrice reprend EXACTEMENT les paliers de l'ancienne (mois de sécurité × taux d'épargne ×
 * comportement d'investissement), en remplaçant chaque réponse par sa mesure :
 *   q5 « combien de temps tiendrais-tu ? »  → mois de sécurité (épargne ÷ revenu)
 *   q6 « quelle part mets-tu de côté ? »    → taux d'épargne constaté (mis de côté ÷ revenu)
 *   q4 « que fais-tu de ce qui reste ? »    → épargne-t-il / investit-il vraiment ?
 */
export interface ProfileDataInputs {
  /** Épargne disponible (comptes d'épargne). */
  availableSavings: number;
  /** Revenu mensuel moyen CONSTATÉ. 0/absent = donnée manquante → P1. */
  avgMonthlyIncome: number;
  /** Mis de côté chaque mois en moyenne (épargne + investissement). */
  monthlySetAside: number;
  /** Total réellement placé sur des comptes d'investissement. */
  totalInvested: number;
}

/** Seuils du taux d'épargne, alignés sur les anciennes tranches déclarées (10 % / 20 %). */
const RATE_MID = 0.10;
const RATE_HIGH = 0.20;

export function computeProfileFromData(i: ProfileDataInputs): FinancialProfileId {
  // Sans revenu constaté, aucun ratio n'a de sens : on ne devine pas, on reste au plus prudent.
  if (!(i.avgMonthlyIncome > 0)) return 'P1';

  const months = computeSecurityCushion({
    availableSavings: Math.max(0, i.availableSavings),
    avgMonthlyIncome: i.avgMonthlyIncome,
  }).months;
  if (months == null) return 'P1';

  const rate = Math.max(0, i.monthlySetAside) / i.avgMonthlyIncome;
  const rateHigh = rate >= RATE_HIGH;
  const rateMid = rate >= RATE_MID;
  // « Investit » = il a réellement placé de l'argent (équivalent des deux dernières options de q4).
  const invests = i.totalInvested > 0;
  // « Épargne régulièrement » = il met effectivement de côté (équivalent des options épargne de q4).
  const saves = i.monthlySetAside > 0;

  // P5 : plus de 6 mois de sécurité ET (il investit OU il met beaucoup de côté).
  if (months > 6 && (invests || rateHigh)) return 'P5';
  // P4 : plus de 6 mois, ou 3–6 mois avec un fort taux d'épargne.
  if (months > 6) return 'P4';
  if (months >= 3 && rateHigh) return 'P4';
  // P3 : 3–6 mois avec un comportement d'épargne, ou 1–3 mois avec un fort taux.
  if (months >= 3 && saves) return 'P3';
  if (months >= 1 && rateHigh) return 'P3';
  // P2 : 1–3 mois, ou 3–6 mois sans rien mettre de côté, ou moins d'un mois mais un taux correct.
  if (months >= 1) return 'P2';
  if (months >= 3) return 'P2';
  if (rateMid) return 'P2';
  // P1 : tout le reste.
  return 'P1';
}

export function computeInitialProfile(answers: QuestionnaireAnswers): FinancialProfileId {
  const { q4, q5, q6 } = answers;

  // Cas immédiat P1 : découvert
  if (q4 === 'Rien, je finis souvent le mois à découvert') return 'P1';

  // P5 : > 6 mois ET (investit OU Q6 ≥ 20 %)
  if (q5 === 'Plus de 6 mois' && (Q4_INVEST.has(q4) || Q6_HIGH.has(q6))) return 'P5';

  // P4 : > 6 mois (reste) OU (3-6 mois ET Q6 ≥ 20 %)
  if (q5 === 'Plus de 6 mois') return 'P4';
  if (q5 === '3 à 6 mois' && Q6_HIGH.has(q6)) return 'P4';

  // P3 : 3-6 mois ET comportement d'épargne/invest OU (1-3 mois ET Q6 ≥ 20 %)
  if (q5 === '3 à 6 mois' && Q4_SAVING.has(q4)) return 'P3';
  if (q5 === '1 à 3 mois' && Q6_HIGH.has(q6)) return 'P3';

  // P2 : 1-3 mois (reste) OU 3-6 mois minimal OU < 1 mois ET Q6 ≥ 10 %
  if (q5 === '1 à 3 mois') return 'P2';
  if (q5 === '3 à 6 mois' && Q4_MINIMAL.has(q4)) return 'P2';
  if (q5 === "Moins d'un mois" && Q6_MID.has(q6)) return 'P2';

  // P1 : tous les cas restants
  return 'P1';
}

// ── Moteur automatique ────────────────────────────────────────

export interface MatrixConfig {
  upgrade_months_threshold: number;
  upgrade_flux_threshold: number;
  downgrade_months_threshold: number;
  downgrade_flux_threshold: number;
  anti_yoyo_months: number;
  exceptional_drop_threshold_pct: number;
  exceptional_drop_months: number;
  irregular_drop_threshold_pct: number;
}

export interface MonthlyMetrics {
  mois_securite: number;
  /** Part des recettes mise de côté, en POURCENTAGE (épargne + investissement). */
  flux_total: number;
  /** Montant mis de côté chaque mois, en EUROS. ⚠️ À ne pas confondre avec `flux_total`, qui est un
   *  pourcentage : le profil vivant les a longtemps confondus et lisait un taux d'épargne de 1,5 %
   *  là où l'utilisateur en mettait 30 % — aucun palier « fort taux » ne se déclenchait jamais. */
  set_aside_monthly: number;
  avg_income_6m: number;
  avg_income_2m: number;
}

export interface AutoEvalResult {
  newProfileId: FinancialProfileId;
  changed: boolean;
  reason: 'automatic_upgrade' | 'automatic_downgrade' | 'exceptional_revenue_drop' | null;
  consecutiveUpgrade: number;
  consecutiveDowngrade: number;
}

const TRANSITION_MAP: Record<string, { up: string; down: string }> = {
  P1: { up: 'P1_P2', down: '' },
  P2: { up: 'P2_P3', down: 'P1_P2' },
  P3: { up: 'P3_P4', down: 'P2_P3' },
  P4: { up: 'P4_P5', down: 'P3_P4' },
  P5: { up: '',      down: 'P4_P5' },
};

export function evaluateAutoTransition(
  currentProfile: FinancialProfileId,
  metrics: MonthlyMetrics,
  consecutiveUpgrade: number,
  consecutiveDowngrade: number,
  configs: Record<string, MatrixConfig>,
  isIrregularIncome: boolean,
): AutoEvalResult {
  const num = parseInt(currentProfile.replace('P', ''));
  const { up, down } = TRANSITION_MAP[currentProfile];

  // ── Règles exceptionnelles (priorité absolue) ─────────────

  const dropThreshold = isIrregularIncome
    ? (configs[up]?.irregular_drop_threshold_pct ?? 20) / 100
    : (configs[up]?.exceptional_drop_threshold_pct ?? 50) / 100;

  // Revenus nuls : descente de 2 niveaux
  if (metrics.avg_income_2m === 0 && metrics.avg_income_6m > 0) {
    const newNum = Math.max(1, num - 2);
    const newProfile = `P${newNum}` as FinancialProfileId;
    return { newProfileId: newProfile, changed: newProfile !== currentProfile, reason: 'exceptional_revenue_drop', consecutiveUpgrade: 0, consecutiveDowngrade: 0 };
  }

  // Revenus < seuil de chute : descente d'1 niveau
  if (metrics.avg_income_6m > 0 && metrics.avg_income_2m < metrics.avg_income_6m * dropThreshold) {
    const newNum = Math.max(1, num - 1);
    const newProfile = `P${newNum}` as FinancialProfileId;
    return { newProfileId: newProfile, changed: newProfile !== currentProfile, reason: 'exceptional_revenue_drop', consecutiveUpgrade: 0, consecutiveDowngrade: 0 };
  }

  // ── Descente (immédiate dès conditions remplies) ──────────

  if (down && configs[down]) {
    const cfg = configs[down];
    if (
      metrics.mois_securite < cfg.downgrade_months_threshold &&
      metrics.flux_total < cfg.downgrade_flux_threshold
    ) {
      const newConsecutive = consecutiveDowngrade + 1;
      const newNum = Math.max(1, num - 1);
      const newProfile = `P${newNum}` as FinancialProfileId;
      return {
        newProfileId: newProfile,
        changed: true,
        reason: 'automatic_downgrade',
        consecutiveUpgrade: 0,
        consecutiveDowngrade: newConsecutive,
      };
    }
  }

  // ── Montée (anti-yoyo : `anti_yoyo_months` mois consécutifs requis — 1 par défaut) ───────

  if (up && configs[up]) {
    const cfg = configs[up];
    if (
      metrics.mois_securite >= cfg.upgrade_months_threshold &&
      metrics.flux_total >= cfg.upgrade_flux_threshold
    ) {
      const newConsecutive = consecutiveUpgrade + 1;
      if (newConsecutive >= cfg.anti_yoyo_months) {
        const newNum = Math.min(5, num + 1);
        const newProfile = `P${newNum}` as FinancialProfileId;
        return {
          newProfileId: newProfile,
          changed: true,
          reason: 'automatic_upgrade',
          consecutiveUpgrade: 0,
          consecutiveDowngrade: 0,
        };
      }
      return {
        newProfileId: currentProfile,
        changed: false,
        reason: null,
        consecutiveUpgrade: newConsecutive,
        consecutiveDowngrade: 0,
      };
    }
  }

  // Aucun changement
  return {
    newProfileId: currentProfile,
    changed: false,
    reason: null,
    consecutiveUpgrade: 0,
    consecutiveDowngrade: consecutiveDowngrade,
  };
}

// ── Calcul des métriques depuis les transactions ──────────────

export interface RawTransaction {
  amount: number;
  date: string;
  account_type: string;
  linked_account_type?: string | null;
}

export function computeMonthlyMetrics(
  transactions: RawTransaction[],
  savingsBalance: number,
  checkingBalance: number,
  windowExpenses: number = 6,
  windowFlux: number = 3,
  /** Tranche de revenu du questionnaire (Q3) — repli du matelas tant qu'aucun revenu n'est constaté. */
  questionnaireQ3?: string | null,
): MonthlyMetrics {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  function monthsAgo(n: number) {
    const d = new Date(currentYear, currentMonth - n, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function txMonth(t: RawTransaction) {
    const d = new Date(t.date);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function inWindow(t: RawTransaction, n: number) {
    const { year, month } = txMonth(t);
    for (let i = 1; i <= n; i++) {
      const w = monthsAgo(i);
      if (w.year === year && w.month === month) return true;
    }
    return false;
  }

  // Épargne disponible (comptes courants + épargne liquidable)
  const epargne_dispo = Math.max(0, savingsBalance) + Math.max(0, checkingBalance);

  // Recettes RÉELLES (virements inter-comptes exclus : un virement entrant n'est pas un revenu).
  const isIncome = (t: RawTransaction) =>
    t.amount > 0 && t.account_type === 'checking' && !t.linked_account_type;

  // Revenus moyens 6 mois vs 2 mois (règles exceptionnelles + base du matelas de sécurité)
  const rev6 = transactions
    .filter(t => inWindow(t, 6) && isIncome(t))
    .reduce((s, t) => s + t.amount, 0);

  const rev2 = transactions
    .filter(t => inWindow(t, 2) && isIncome(t))
    .reduce((s, t) => s + t.amount, 0);

  const avg_income_6m = rev6 / 6;

  // Mois de sécurité — MÊME définition que partout : base = RECETTES (jamais les dépenses),
  // repli sur la tranche du questionnaire tant qu'aucun revenu n'est constaté (lib/securityCushion).
  const mois_securite = computeSecurityCushion({
    availableSavings: epargne_dispo,
    avgMonthlyIncome: avg_income_6m,
    questionnaireQ3,
  }).months ?? 0;

  // Flux épargne & investissement sur 3 mois
  const fluxTxs = transactions.filter(t => inWindow(t, windowFlux));

  const revenusBruts = fluxTxs
    .filter(isIncome)
    .reduce((s, t) => s + t.amount, 0);

  const virEpargne = fluxTxs
    .filter(t => t.amount < 0 && t.linked_account_type === 'savings')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const virInvest = fluxTxs
    .filter(t => t.amount < 0 && t.linked_account_type === 'investment')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const flux_epargne = revenusBruts > 0 ? (virEpargne / revenusBruts) * 100 : 0;
  const flux_invest = revenusBruts > 0 ? (virInvest / revenusBruts) * 100 : 0;
  const flux_total = flux_epargne + flux_invest;

  /* Le même mouvement, mais en EUROS PAR MOIS — c'est ce dont le profil a besoin (il le rapporte
     ensuite au revenu pour en tirer un taux). Fenêtre INCLUANT le mois courant : un compte neuf
     n'a encore aucun mois révolu, et l'écarter revenait à dire « il ne met rien de côté » de
     quelqu'un qui venait précisément de faire son premier virement d'épargne. */
  const inRecent = (t: RawTransaction) => {
    const { year, month } = txMonth(t);
    for (let i = 0; i < windowFlux; i++) {
      const w = monthsAgo(i);
      if (w.year === year && w.month === month) return true;
    }
    return false;
  };
  const setAside = transactions
    .filter((t) => inRecent(t) && t.amount < 0
      && (t.linked_account_type === 'savings' || t.linked_account_type === 'investment'))
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return {
    mois_securite,
    flux_total,
    set_aside_monthly: setAside / windowFlux,
    avg_income_6m,
    avg_income_2m: rev2 / 2,
  };
}
