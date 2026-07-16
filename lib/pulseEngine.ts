/**
 * LE POULS — moteur pur.
 * ──────────────────────
 * Un « état des lieux » de la santé financière : des CONSTATS ponctuels, jugés par des REPÈRES
 * génériques attachés au profil P1–P5. On ne demande aucun objectif chiffré à l'utilisateur :
 * les repères viennent du profil (calculé et réévalué chaque mois par financialProfileEngine).
 *
 * Trois temps, un seul moteur :
 *   • live    — après chaque saisie : les signaux impactés bougent (delta chips) ;
 *   • hebdo   — carte « Pouls de la semaine » à la 1ʳᵉ ouverture de la semaine ;
 *   • mensuel — « État des lieux », offert à la clôture du mois.
 *
 * RÈGLES D'ÉCRITURE DES SIGNAUX (non négociables) :
 *   1. Chaque signal se lit d'un coup d'œil, sans jargon : pas de « rythme », pas de « % du rythme
 *      prévu ». On dit un MONTANT, sur quoi il porte, et si c'est bien ou pas.
 *   2. Tout pourcentage est accompagné de sa base en euros (« 14 % de tes revenus (1 500 €) »).
 *   3. Le signal montre AUSSI où on en est en valeur absolue (total épargné, total investi + ce que
 *      ça a rapporté, solde…), pas seulement une progression.
 *   4. Le Pouls est un ÉTAT, pas un menu : aucun bouton d'action dans les signaux — le reste de
 *      l'app (Pilotage, recommandations, virements) sert à agir.
 *
 * FIABILITÉ : quand la confiance est basse (confidenceEngine), tous les signaux passent en
 * `estimated` — pas de rouge, pas de jugement sur des chiffres douteux (cf. `estimated` ci-dessous).
 */

import type { FinancialProfileId } from '../types/database';
import { computeSecurityCushion, securityMonthsLabel, type SecurityCushionBase } from './securityCushion';

/* ── Signaux ─────────────────────────────────────────────────── */

export type PulseSignalId =
  | 'end_of_month'    // « Fin de mois » : ce qu'il restera au 1er, vs la marge de sécurité
  | 'spending'        // « Dépenses du mois » : dépensé / prévu, et où on finira à ce rythme
  | 'cushion'         // « Matelas de sécurité » : combien de temps tenir sans revenus
  | 'saving'          // « Épargne du mois » : mis de côté ce mois + total épargné
  | 'investing'       // « Investissement du mois » : placé ce mois + total investi + plus-value
  | 'no_overdraft'    // « Jamais dans le rouge » : mois consécutifs sans découvert
  | 'wealth'          // « Ton patrimoine » : total + évolution sur 3 mois
  | 'projects';       // « Tes projets » : projet perso le plus avancé / en retard

export const PULSE_SIGNAL_IDS: PulseSignalId[] = [
  'end_of_month', 'spending', 'cushion', 'saving', 'investing', 'no_overdraft', 'wealth', 'projects',
];

/** Libellés admin (liste de sélection des signaux par profil). */
export const PULSE_SIGNAL_LABELS: Record<PulseSignalId, string> = {
  end_of_month: 'Fin de mois (ce qu’il restera)',
  spending:     'Dépenses variables',
  cushion:      'Matelas de sécurité',
  saving:       'Épargne du mois',
  investing:    'Investissement du mois',
  no_overdraft: 'Jamais dans le rouge',
  wealth:       'Patrimoine',
  projects:     'Projets perso',
};

/**
 * `good` tout va bien · `watch` à surveiller · `alert` ça dérape · `neutral` info sans jugement
 * (ex. série en cours) · `estimated` chiffres non fiables → on n'émet aucun jugement.
 */
export type PulseStatus = 'good' | 'watch' | 'alert' | 'neutral' | 'estimated';

/** Couleur SÉMANTIQUE (clé du thème, jamais une valeur hex) — pilotée par le Style Editor. */
export const PULSE_STATUS_COLOR_KEY: Record<PulseStatus, string> = {
  good: 'green',
  watch: 'orange',
  alert: 'danger',
  neutral: 'blue',
  estimated: 'grey',
};

export interface PulseProgress {
  /** Part remplie (0..1). */
  value: number;
  /** Part PRÉVUE (virements à venir ce mois), affichée en segment plus clair APRÈS `value`,
   *  avec une légende « fait / prévu » sous la barre. Absent ou 0 = pas de segment. */
  planned?: number;
  /** Repère à atteindre, en part (0..1) — le petit trait sur la barre. Absent = pas de repère. */
  target?: number;
}

export interface PulseSignal {
  id: PulseSignalId;
  /** Titre court, sans jargon. */
  label: string;
  /** Emoji du signal (identité visuelle rapide). */
  emoji: string;
  status: PulseStatus;
  /** LA phrase du signal : un montant, ce qu'il représente. Ex. « Il te restera 512 € le 1er août ». */
  headline: string;
  /** La précision utile (repère, base du %, échéance…). Une phrase, jamais deux. */
  detail?: string;
  /** Où on en est en valeur absolue. Ex. « Total investi : 3 400 € · +180 € de gains ». */
  amountLine?: string;
  /** Pastille de droite (état lisible sans lire le texte). */
  chip: string;
  progress?: PulseProgress;
}

/* ── Repères par profil (éditables en admin) ─────────────────── */

export interface PulseBenchmark {
  /** Matelas visé, en mois de revenus. */
  cushionMonths: number;
  /** Part des revenus à mettre de côté chaque mois (%). 0 = signal non jugé. */
  savingRatePct: number;
  /** Part de la capacité d'investissement du mois à utiliser pour être « au vert » (%). */
  investOfCapacityPct: number;
}

export interface PulseConfig {
  enabled: boolean;
  /** Les trois temps, activables séparément. */
  live: boolean;
  weekly: boolean;
  monthly: boolean;
  /** Signaux retenus, par profil, dans l'ordre d'affichage. */
  signalsByProfile: Record<FinancialProfileId, PulseSignalId[]>;
  benchmarks: Record<FinancialProfileId, PulseBenchmark>;
  /** Notification hebdo (envoi réel : cron / admin — cf. écran admin Pouls). */
  weeklyPush: { enabled: boolean; weekday: number; hour: number; title: string; body: string };
}

/**
 * Défauts : les signaux MONTENT avec le profil — 5 par profil (sans plafond : l'admin en ajoute
 * autant qu'il veut, l'état des lieux défile).
 *  P1 — tenir le mois, ne pas déraper, poser un premier matelas (jamais d'investissement).
 *  P2 — construire la réserve, garder les dépenses sous contrôle.
 *  P3 — réserve tenue, l'investissement entre en jeu.
 *  P4 — l'investissement devient le sujet principal, le matelas s'entretient.
 *  P5 — patrimoine et projets : l'épargne pure n'est plus un enjeu (repère à 0 %).
 * Les PROJETS PERSO sont présents pour TOUS les profils (décision produit).
 */
export const DEFAULT_PULSE_SIGNALS: Record<FinancialProfileId, PulseSignalId[]> = {
  P1: ['end_of_month', 'spending', 'cushion', 'no_overdraft', 'projects'],
  P2: ['cushion', 'saving', 'spending', 'no_overdraft', 'projects'],
  P3: ['cushion', 'investing', 'saving', 'spending', 'projects'],
  P4: ['investing', 'cushion', 'spending', 'no_overdraft', 'projects'],
  P5: ['investing', 'wealth', 'cushion', 'no_overdraft', 'projects'],
};

export const DEFAULT_PULSE_BENCHMARKS: Record<FinancialProfileId, PulseBenchmark> = {
  P1: { cushionMonths: 1, savingRatePct: 5,  investOfCapacityPct: 0 },
  P2: { cushionMonths: 3, savingRatePct: 10, investOfCapacityPct: 50 },
  P3: { cushionMonths: 3, savingRatePct: 15, investOfCapacityPct: 60 },
  P4: { cushionMonths: 6, savingRatePct: 10, investOfCapacityPct: 70 },
  P5: { cushionMonths: 3, savingRatePct: 0,  investOfCapacityPct: 70 },
};

export const DEFAULT_PULSE_CONFIG: PulseConfig = {
  enabled: true,
  live: true,
  weekly: true,
  monthly: true,
  signalsByProfile: DEFAULT_PULSE_SIGNALS,
  benchmarks: DEFAULT_PULSE_BENCHMARKS,
  weeklyPush: {
    enabled: true,
    weekday: 0, // 0 = dimanche
    hour: 21,
    title: 'Ton point de la semaine 🧭',
    body: 'Ouvre Relyka pour voir où tu en es cette semaine.',
  },
};

/** Fusionne la config stockée (admin) avec les défauts — une config partielle reste valide. */
export function resolvePulseConfig(stored: Partial<PulseConfig> | null | undefined): PulseConfig {
  if (!stored) return DEFAULT_PULSE_CONFIG;
  const profiles: FinancialProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5'];
  const signalsByProfile = {} as Record<FinancialProfileId, PulseSignalId[]>;
  const benchmarks = {} as Record<FinancialProfileId, PulseBenchmark>;
  for (const p of profiles) {
    const raw = stored.signalsByProfile?.[p];
    // Garde-fou : une config stockée peut contenir un signal retiré du code → on le filtre.
    const kept = Array.isArray(raw) ? raw.filter((s) => PULSE_SIGNAL_IDS.includes(s)) : null;
    signalsByProfile[p] = kept && kept.length > 0 ? kept : DEFAULT_PULSE_SIGNALS[p];
    benchmarks[p] = { ...DEFAULT_PULSE_BENCHMARKS[p], ...(stored.benchmarks?.[p] ?? {}) };
  }
  return {
    enabled: stored.enabled ?? DEFAULT_PULSE_CONFIG.enabled,
    live: stored.live ?? DEFAULT_PULSE_CONFIG.live,
    weekly: stored.weekly ?? DEFAULT_PULSE_CONFIG.weekly,
    monthly: stored.monthly ?? DEFAULT_PULSE_CONFIG.monthly,
    signalsByProfile,
    benchmarks,
    weeklyPush: { ...DEFAULT_PULSE_CONFIG.weeklyPush, ...(stored.weeklyPush ?? {}) },
  };
}

/* ── Entrées du moteur ───────────────────────────────────────── */

export interface PulseInputs {
  profileId: FinancialProfileId;
  /** Aujourd'hui (injecté → testable). */
  today: Date;

  // Fin de mois
  /** Solde courant projeté au 1er du mois prochain (trajectoire de l'écran Projection). */
  endOfMonthBalance: number;
  /** Montant que l'utilisateur veut toujours garder sur son compte (questionnaire Q8). */
  safetyMargin: number;
  /** Réservé + cumuls fléchés : de l'argent mentalement mis de côté qui reste PHYSIQUEMENT sur le
   *  compte. Il est DANS le solde de fin de mois mais PAS dans le Relyka — on l'affiche pour que
   *  « il devrait te rester 724 € » et « Relyka 560 € » ne semblent pas se contredire. */
  reservedOnAccount?: number;

  // Dépenses du mois
  /** Enveloppe de dépenses variables estimée pour le mois. 0 = pas encore estimable. */
  spendingBudget: number;
  /** Déjà dépensé (variables) depuis le 1er. */
  spendingSoFar: number;

  // Épargne / matelas
  /** Total sur les comptes d'épargne. */
  savingsBalance: number;
  /** Mis de côté ce mois-ci (virements EXÉCUTÉS vers l'épargne, projets compris). */
  savedThisMonth: number;
  /** Virements d'épargne encore À VENIR ce mois-ci (datés > aujourd'hui) — segment « prévu ». */
  savingsPlannedThisMonth?: number;
  /** Revenu mensuel moyen constaté (0 = non détecté). */
  avgMonthlyIncome: number;
  /** Tranche de revenu du questionnaire (repli du matelas tant qu'aucune recette n'est constatée). */
  questionnaireQ3?: string | null;

  // Investissement
  investedBalance: number;
  investedThisMonth: number;
  /** Virements d'investissement encore À VENIR ce mois-ci — segment « prévu ». */
  investPlannedThisMonth?: number;
  /** Plus/moins-values cumulées (ce que le placement a rapporté). */
  investmentGains: number;
  /** Capacité d'investissement du mois = budget libre × allocation du profil. */
  investCapacity: number;

  // Patrimoine
  totalWealth: number;
  /** Patrimoine 3 mois plus tôt (snapshot). null = pas encore d'historique. */
  wealth3mAgo: number | null;

  // Séries
  /** Mois consécutifs terminés sans découvert. */
  monthsWithoutOverdraft: number;

  // Projets perso
  // onTrack : true = dans les temps · false = en retard · null = INDÉTERMINÉ (saisie manuelle → neutre).
  projects: { id: string; name: string; target: number; saved: number; progressPct: number; onTrack: boolean | null }[];

  /** Confiance basse → tous les signaux en « estimé » (aucun jugement sur des chiffres douteux). */
  lowConfidence: boolean;
}

export interface PulseResult {
  signals: PulseSignal[];
  greenCount: number;
  /** Signaux réellement jugés (hors `neutral`/`estimated`) — dénominateur des pastilles. */
  judgedCount: number;
  /** Tous les signaux jugés sont au vert. */
  allGreen: boolean;
  /** État global : le pire statut rencontré. */
  worst: PulseStatus;
  /** La phrase de synthèse (une seule, en tête de carte). */
  headline: string;
  /** Chiffres non fiables → le Pouls s'affiche en « estimé ». */
  estimated: boolean;
}

/* ── Formatage ───────────────────────────────────────────────── */

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const pct = (n: number) => `${Math.round(n)} %`;

/** « le 1er août » — le jour où le mois bascule (parlant, pas « fin de période »). */
function firstOfNextMonthLabel(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `le 1er ${d.toLocaleDateString('fr-FR', { month: 'long' })}`;
}

/** Part du mois déjà écoulée (0..1) — sert à projeter les dépenses de fin de mois. */
export function monthElapsedRatio(today: Date): number {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Math.min(1, Math.max(1 / daysInMonth, today.getDate() / daysInMonth));
}

/* ── Construction de chaque signal ───────────────────────────── */

function buildEndOfMonth(i: PulseInputs): PulseSignal {
  const left = i.endOfMonthBalance;
  const margin = Math.max(0, i.safetyMargin);
  const above = left - margin;
  const status: PulseStatus =
    left < 0 ? 'alert' : above < 0 ? 'watch' : 'good';

  // Une PROJECTION se dit toujours au conditionnel (« devrais », « passerais ») : rien n'est acquis.
  const detail = margin > 0
    ? (above >= 0
        ? `Tu devrais être ${eur(above)} au-dessus de ta marge de sécurité (${eur(margin)}).`
        : `Tu devrais passer sous ta marge de sécurité (${eur(margin)}).`)
    : (left >= 0 ? 'Ton compte devrait rester dans le vert jusqu’au bout du mois.' : 'Ton compte passerait dans le rouge avant la fin du mois.');

  // Le réservé (projets, cumuls) reste SUR le compte : il est dans ce solde, mais pas dans le
  // budget libre (Relyka). Le dire évite le faux paradoxe « il me reste 724 € mais Relyka 560 € ».
  const reserved = Math.max(0, i.reservedOnAccount ?? 0);
  const amountLine = reserved > 0 && left >= 0
    ? `Dont ${eur(reserved)} réservés${margin > 0 ? ` et ${eur(margin)} de marge` : ''}.`
    : undefined;

  return {
    id: 'end_of_month',
    label: 'Fin de mois',
    emoji: '🗓️',
    status,
    headline: left >= 0
      ? `Il devrait te rester ${eur(left)} ${firstOfNextMonthLabel(i.today)}`
      : `Tu serais à ${eur(left)} ${firstOfNextMonthLabel(i.today)}`,
    detail,
    amountLine,
    chip: status === 'good' ? 'Bien parti' : status === 'watch' ? 'Ça va être juste' : 'Découvert en vue',
  };
}

function buildSpending(i: PulseInputs): PulseSignal {
  const budget = Math.max(0, i.spendingBudget);
  const spent = Math.max(0, i.spendingSoFar);

  // Pas d'enveloppe estimable (nouvel utilisateur) → on montre le montant, sans juger.
  if (budget <= 0) {
    return {
      id: 'spending', label: 'Dépenses variables', emoji: '🛒', status: 'neutral',
      headline: `${eur(spent)} dépensés ce mois-ci`,
      detail: 'Encore un peu de suivi et Relyka saura te dire si c’est beaucoup pour toi.',
      chip: 'À suivre',
    };
  }

  const elapsed = monthElapsedRatio(i.today);

  // Tout début de mois : un resto le 2 ferait « exploser » la projection. Tant que le mois vient de
  // commencer et que l'enveloppe n'est pas sérieusement entamée, on constate sans juger.
  if (elapsed < 0.15 && spent < budget * 0.5) {
    return {
      id: 'spending', label: 'Dépenses variables', emoji: '🛒', status: 'neutral',
      // « estimés » (pas « prévus ») : l'enveloppe variable est une ESTIMATION, pas un plan.
      headline: `${eur(spent)} dépensés sur les ${eur(budget)} estimés`,
      detail: 'Le mois vient de commencer : trop tôt pour juger ton rythme.',
      chip: 'Début de mois',
      progress: { value: spent / budget, target: 1 },
    };
  }

  // Enveloppe DÉJÀ dépassée : ce n'est plus une projection, c'est un fait → on dit juste de combien.
  if (spent > budget) {
    const over = spent - budget;
    return {
      id: 'spending', label: 'Dépenses variables', emoji: '🛒', status: 'alert',
      headline: `${eur(spent)} dépensés sur les ${eur(budget)} estimés`,
      detail: `Tu as dépassé ton estimation variable de ${eur(over)}.`,
      chip: 'Budget dépassé',
      progress: { value: 1, target: 1 },
    };
  }

  // Pas encore dépassé : on PROJETTE la fin de mois au rythme actuel → conditionnel.
  const projected = spent / elapsed;
  const overshoot = projected - budget;
  const status: PulseStatus = overshoot > budget * 0.1 ? 'alert' : overshoot > 0 ? 'watch' : 'good';

  return {
    id: 'spending',
    label: 'Dépenses variables',
    emoji: '🛒',
    status,
    headline: `${eur(spent)} dépensés sur les ${eur(budget)} estimés`,
    detail: status === 'good'
      ? `À ce rythme, tu finirais le mois vers ${eur(projected)} : dans ton budget.`
      : `À ce rythme, tu finirais le mois vers ${eur(projected)}, soit ${eur(overshoot)} de trop.`,
    chip: status === 'good' ? 'Dans ton budget' : status === 'watch' ? 'Ça monte vite' : 'Tu risques de dépasser',
    progress: { value: spent / budget, target: 1 },
  };
}

/**
 * Paliers du matelas de sécurité : 1 mois (le coup dur encaissé), 3 mois (le trou d'air),
 * 6 mois (la vraie tranquillité). Au-delà du dernier palier, on n'affiche PLUS d'objectif :
 * « il faudrait X » n'aurait aucun sens pour quelqu'un qui a déjà largement de quoi tenir.
 */
const CUSHION_MILESTONES = [1, 3, 6];

/** Prochain palier à viser, ou `null` si tous sont franchis. */
function nextCushionMilestone(months: number): number | null {
  return CUSHION_MILESTONES.find((m) => months < m) ?? null;
}

function buildCushion(i: PulseInputs, b: PulseBenchmark): PulseSignal {
  const cushion = computeSecurityCushion({
    availableSavings: i.savingsBalance,
    avgMonthlyIncome: i.avgMonthlyIncome,
    questionnaireQ3: i.questionnaireQ3,
  });

  // Aucune base de revenu : on montre le montant épargné, sans le convertir en « mois ».
  if (cushion.months == null) {
    return {
      id: 'cushion', label: 'Matelas de sécurité', emoji: '🛟', status: 'neutral',
      headline: `${eur(i.savingsBalance)} d’épargne de côté`,
      detail: 'Ajoute ton revenu pour savoir combien de temps tu tiendrais sans rentrée d’argent.',
      chip: 'À compléter',
    };
  }

  const months = cushion.months;
  const threshold = Math.max(0.5, b.cushionMonths);
  const status: PulseStatus =
    months >= threshold ? 'good' : months >= threshold * 0.5 ? 'watch' : 'alert';
  const base: SecurityCushionBase = cushion.base ?? 'income';

  // Prochain palier chiffré : « 6 mois (12 723 € / ~15 237 €) » — épargne actuelle / épargne visée.
  // La cible est le nb de mois × le revenu de référence (reference = épargne ÷ mois couverts).
  const next = nextCushionMilestone(months);
  const estimated = base === 'income' ? '' : ' (estimation)';
  const detail = next
    ? `Prochain palier : ${next} mois${estimated} (${eur(i.savingsBalance)} / ~${eur(next * cushion.reference)}).`
    : `Tu as de quoi voir venir (${eur(i.savingsBalance)} d'épargne)${estimated}.`;

  return {
    id: 'cushion',
    label: 'Matelas de sécurité',
    emoji: '🛟',
    status,
    headline: `Tu pourrais tenir ${securityMonthsLabel(months)} sans rentrée d’argent`,
    detail,
    chip: status === 'good' ? 'Solide' : status === 'watch' ? 'À renforcer' : 'Trop juste',
    // La barre se remplit vers le PROCHAIN palier ; tous franchis → pleine.
    progress: { value: next ? Math.min(1, months / next) : 1, target: 1 },
  };
}

function buildSaving(i: PulseInputs, b: PulseBenchmark): PulseSignal {
  const saved = Math.max(0, i.savedThisMonth);
  // Virements d'épargne encore À VENIR ce mois : comptés dans le jugement (sinon la carte est
  // « rouge » en début de mois alors que le virement du 25 est déjà programmé), affichés en
  // segment plus clair sur la barre (légende « fait / prévu »).
  const planned = Math.max(0, i.savingsPlannedThisMonth ?? 0);
  const effort = saved + planned;
  const income = i.avgMonthlyIncome;
  const targetPct = b.savingRatePct;

  // Profil qui n'a plus à épargner (P5) ou revenu inconnu → constat simple, sans jugement.
  if (targetPct <= 0 || income <= 0) {
    return {
      id: 'saving', label: 'Épargne du mois', emoji: '🐖', status: 'neutral',
      headline: `${eur(saved)} mis de côté ce mois-ci`,
      detail: planned > 0 ? `Et ${eur(planned)} encore prévus d’ici la fin du mois.` : undefined,
      amountLine: `Épargne totale : ${eur(i.savingsBalance)}`,
      chip: effort > 0 ? 'C’est fait' : 'Rien pour l’instant',
    };
  }

  const targetAmount = (targetPct / 100) * income;
  const ratePct = (effort / income) * 100;
  const status: PulseStatus =
    effort >= targetAmount ? 'good' : effort >= targetAmount * 0.5 ? 'watch' : 'alert';

  const valuePart = Math.min(1, targetAmount > 0 ? saved / targetAmount : 0);
  return {
    id: 'saving',
    label: 'Épargne du mois',
    emoji: '🐖',
    status,
    headline: `${eur(saved)} mis de côté ce mois-ci`,
    detail: planned > 0
      ? `Avec ${eur(planned)} encore prévus, soit ${pct(ratePct)} de tes revenus (${eur(income)} par mois).`
      : `Soit ${pct(ratePct)} de tes revenus (${eur(income)} par mois).`,
    amountLine: `Épargne totale : ${eur(i.savingsBalance)}`,
    // Réel vs recommandé (le montant recommandé sert au calcul, sans être affiché comme un « repère »).
    chip: status === 'good' ? 'Bien épargné' : status === 'watch' ? 'À mi-chemin' : 'Peu épargné',
    progress: {
      value: valuePart,
      planned: Math.min(1 - valuePart, targetAmount > 0 ? planned / targetAmount : 0),
      target: 1,
    },
  };
}

/** En-dessous de ce montant plaçable, on ne juge pas : un « À lancer » rouge pour 5 € serait absurde. */
const MIN_JUDGEABLE_CAPACITY = 20;

function buildInvesting(i: PulseInputs, b: PulseBenchmark): PulseSignal {
  const placed = Math.max(0, i.investedThisMonth);
  // Virements d'invest encore À VENIR ce mois : comptés dans le jugement (un virement programmé
  // le 25 ne doit pas laisser la carte « À lancer »), segment plus clair sur la barre.
  const planned = Math.max(0, i.investPlannedThisMonth ?? 0);
  const engaged = placed + planned;
  const capacity = Math.max(0, i.investCapacity);
  const gains = i.investmentGains;
  const gainLine = gains === 0
    ? ''
    : ` · ${gains > 0 ? '+' : '−'}${eur(Math.abs(gains))} ${gains > 0 ? 'de gains' : 'de pertes'}`;
  const amountLine = `Total investi : ${eur(i.investedBalance)}${gainLine}`;
  const headline = placed > 0
    ? `${eur(placed)} placés ce mois-ci`
    : planned > 0
      ? `${eur(planned)} d’investissement prévus ce mois-ci`
      : 'Rien de placé ce mois-ci';

  // Pas (ou presque pas) de capacité d'investissement ce mois → on ne juge pas.
  if (capacity < MIN_JUDGEABLE_CAPACITY || b.investOfCapacityPct <= 0) {
    return {
      id: 'investing', label: 'Investissement du mois', emoji: '📈', status: 'neutral',
      headline,
      detail: capacity < MIN_JUDGEABLE_CAPACITY
        ? 'Ton budget du mois ne laisse plus de place pour investir : ça reviendra.'
        : undefined,
      amountLine,
      chip: engaged > 0 ? 'C’est fait' : 'Pas ce mois-ci',
    };
  }

  // Le seuil de « bon rythme » reste piloté en admin, mais on ne l'ANNONCE pas comme un idéal :
  // on donne le fait, la couleur fait le reste.
  const threshold = (b.investOfCapacityPct / 100) * capacity;
  const status: PulseStatus =
    engaged >= threshold ? 'good' : engaged > 0 ? 'watch' : 'alert';

  // Le détail parle du RESTANT plaçable (capacité − fait − prévu), jamais de la capacité brute :
  // « tu pourrais placer jusqu'à 25 € » après avoir justement placé 25 € (capacité = fait + reco,
  // reco tombée à 0) lisait comme « tu peux ENCORE placer 25 € » — contradictoire avec les recos.
  const remaining = Math.max(0, capacity - engaged);
  const detail = remaining >= MIN_JUDGEABLE_CAPACITY
    ? (engaged > 0
        ? `Tu peux encore placer ${eur(remaining)} sans te mettre en difficulté.`
        : `Ce mois-ci, tu pourrais placer jusqu’à ${eur(remaining)} sans te mettre en difficulté.`)
    : `Selon ton Relyka et la projection il n'est pas conseillé d'investir plus.`;

  const valuePart = Math.min(1, capacity > 0 ? placed / capacity : 0);
  return {
    id: 'investing',
    label: 'Investissement du mois',
    emoji: '📈',
    status,
    headline,
    detail,
    amountLine,
    chip: status === 'good' ? 'Bon rythme' : status === 'watch' ? 'Tu peux aller plus loin' : 'À lancer',
    // La barre se remplit sur ce qui était RÉELLEMENT plaçable (fait + segment « prévu » plus
    // clair) ; le trait marque le seuil du profil.
    progress: {
      value: valuePart,
      planned: Math.min(1 - valuePart, capacity > 0 ? planned / capacity : 0),
      target: b.investOfCapacityPct / 100,
    },
  };
}

function buildNoOverdraft(i: PulseInputs): PulseSignal {
  const n = Math.max(0, i.monthsWithoutOverdraft);
  return {
    id: 'no_overdraft',
    label: 'Jamais dans le rouge',
    emoji: '✅',
    status: n > 0 ? 'good' : 'neutral',
    headline: n === 0
      ? 'Ce mois-ci, garde ton compte au-dessus de zéro'
      : n === 1
        ? 'Le mois dernier, tu as fini dans le vert'
        : `${n} mois de suite sans jamais être dans le rouge`,
    chip: n >= 3 ? '🔥 Série' : n > 0 ? 'Tenu' : 'À démarrer',
  };
}

function buildWealth(i: PulseInputs): PulseSignal {
  const total = i.totalWealth;
  const before = i.wealth3mAgo;

  if (before == null || before <= 0) {
    return {
      id: 'wealth', label: 'Ton patrimoine', emoji: '🌍', status: 'neutral',
      headline: `${eur(total)} au total`,
      detail: 'Tes comptes courants, ton épargne et tes investissements réunis. On te montrera son évolution dans quelques mois.',
      chip: 'Point de départ',
    };
  }

  const diff = total - before;
  const changePct = (diff / before) * 100;
  const status: PulseStatus = diff > 0 ? 'good' : diff < 0 ? 'watch' : 'neutral';

  return {
    id: 'wealth',
    label: 'Ton patrimoine',
    emoji: '🌍',
    status,
    headline: `${eur(total)} au total`,
    detail: diff === 0
      ? 'Stable depuis 3 mois.'
      : `${diff > 0 ? '+' : '−'}${eur(Math.abs(diff))} en 3 mois (${diff > 0 ? '+' : '−'}${pct(Math.abs(changePct))}).`,
    amountLine: 'Comptes courants + épargne + investissements',
    chip: diff > 0 ? 'Ça monte' : diff < 0 ? 'En baisse' : 'Stable',
  };
}

function buildProjects(i: PulseInputs): PulseSignal | null {
  if (i.projects.length === 0) return null;

  // Priorité d'affichage : un projet EN RETARD (onTrack === false) d'abord, sinon le plus avancé.
  const late = i.projects.filter((p) => p.onTrack === false).sort((a, b) => a.progressPct - b.progressPct)[0];
  const best = [...i.projects].sort((a, b) => b.progressPct - a.progressPct)[0];
  const p = late ?? best;
  const others = i.projects.length - 1;

  // Saisie manuelle (onTrack null) et pas de projet en retard → on constate, sans juger le rythme.
  const status: PulseStatus = late ? 'watch' : p.onTrack === null ? 'neutral' : 'good';
  const detail = late
    ? 'Tu mets moins de côté que prévu pour ce projet : il risque de prendre du retard.'
    : p.onTrack === null
      ? 'Tu l’alimentes à ton rythme, quand tu veux.'
      : 'Tu es dans les temps pour ce projet.';
  const chip = late ? 'En retard' : p.onTrack === null ? 'En cours' : 'Dans les temps';

  return {
    id: 'projects',
    label: i.projects.length > 1 ? 'Tes projets' : 'Ton projet',
    emoji: '🎯',
    status,
    headline: `${p.name} : ${eur(p.saved)} sur ${eur(p.target)}`,
    detail,
    amountLine: others > 0 ? `Et ${others} autre${others > 1 ? 's' : ''} projet${others > 1 ? 's' : ''} en cours` : undefined,
    chip,
    progress: { value: Math.min(1, p.progressPct / 100), target: 1 },
  };
}

/* ── Moteur ──────────────────────────────────────────────────── */

const BUILDERS: Record<PulseSignalId, (i: PulseInputs, b: PulseBenchmark) => PulseSignal | null> = {
  end_of_month: (i) => buildEndOfMonth(i),
  spending: (i) => buildSpending(i),
  cushion: (i, b) => buildCushion(i, b),
  saving: (i, b) => buildSaving(i, b),
  investing: (i, b) => buildInvesting(i, b),
  no_overdraft: (i) => buildNoOverdraft(i),
  wealth: (i) => buildWealth(i),
  projects: (i) => buildProjects(i),
};

const SEVERITY: Record<PulseStatus, number> = { good: 0, neutral: 0, estimated: 1, watch: 2, alert: 3 };

/**
 * Deux formats, un seul moteur :
 *  • 'full' — l'état des lieux complet (tous les signaux du profil) : rendez-vous mensuel + à la demande ;
 *  • 'week' — le pouls HEBDO, volontairement léger : 3 signaux max, centrés sur ce qui bouge d'une
 *    semaine à l'autre (dépenses, fin de mois, + l'épargne OU l'invest du mois selon le profil).
 *    Le patrimoine, le matelas ou les projets ne changent pas en 7 jours : ils restent au mensuel.
 */
export type PulseKind = 'full' | 'week';

/** Signaux qui ont du sens à l'échelle d'une semaine. */
const WEEKLY_CANDIDATES: PulseSignalId[] = ['spending', 'end_of_month', 'saving', 'investing'];

function weeklyIds(profileIds: PulseSignalId[]): PulseSignalId[] {
  // Dépenses + fin de mois pour tout le monde, puis les signaux « du mois » du profil.
  const ids = [...new Set<PulseSignalId>([
    'spending', 'end_of_month',
    ...profileIds.filter((id) => WEEKLY_CANDIDATES.includes(id)),
  ])];
  return ids.slice(0, 3);
}

export function computePulse(
  inputs: PulseInputs,
  config: PulseConfig = DEFAULT_PULSE_CONFIG,
  kind: PulseKind = 'full',
): PulseResult {
  const benchmark = config.benchmarks[inputs.profileId] ?? DEFAULT_PULSE_BENCHMARKS[inputs.profileId];
  const profileIds = config.signalsByProfile[inputs.profileId] ?? DEFAULT_PULSE_SIGNALS[inputs.profileId];
  const ids = kind === 'week' ? weeklyIds(profileIds) : profileIds;

  const signals: PulseSignal[] = [];
  for (const id of ids) {
    const signal = BUILDERS[id]?.(inputs, benchmark);
    if (signal) signals.push(signal);
  }

  // Confiance basse : on N'ÉMET AUCUN JUGEMENT. Les chiffres restent affichés (ils ont une valeur
  // indicative) mais tout passe en « estimé » — pas de rouge sur des données probablement fausses.
  if (inputs.lowConfidence) {
    for (const s of signals) {
      s.status = 'estimated';
      s.chip = 'Estimé';
    }
  }

  const judged = signals.filter((s) => s.status === 'good' || s.status === 'watch' || s.status === 'alert');
  const greenCount = judged.filter((s) => s.status === 'good').length;
  const worst = signals.reduce<PulseStatus>(
    (acc, s) => (SEVERITY[s.status] > SEVERITY[acc] ? s.status : acc),
    'good',
  );

  return {
    signals,
    greenCount,
    judgedCount: judged.length,
    allGreen: judged.length > 0 && greenCount === judged.length,
    worst,
    headline: buildHeadline(signals, greenCount, judged.length, inputs.lowConfidence),
    estimated: inputs.lowConfidence,
  };
}

/** La phrase de synthèse en tête de carte : courte, encourageante, jamais culpabilisante. */
function buildHeadline(signals: PulseSignal[], green: number, judged: number, lowConfidence: boolean): string {
  if (lowConfidence) return 'Tes chiffres ne sont plus à jour. Vérifie ton solde pour un vrai bilan.';
  if (judged === 0) return 'Saisis tes premières opérations : ton bilan arrive.';
  if (green === judged) return 'Tout est au vert. Continue comme ça !';

  const worst = signals.find((s) => s.status === 'alert') ?? signals.find((s) => s.status === 'watch');
  if (green === 0) return worst ? `À reprendre en priorité : ${worst.label.toLowerCase()}.` : 'Plusieurs points à reprendre.';
  const count = green === 1 ? '1 signal' : `${green} signaux`;
  return worst
    ? `${count} sur ${judged} au vert. À suivre : ${worst.label.toLowerCase()}.`
    : `${count} sur ${judged} au vert.`;
}

/* ── Clés de période (hebdo / mensuel) ───────────────────────── */

/** Semaine ISO au format « 2026-W29 » (lundi = début de semaine). */
export function weekKey(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Jeudi de la semaine courante → détermine l'année ISO.
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const isoYear = x.getFullYear();
  const week1 = new Date(isoYear, 0, 4);
  const diff = (x.getTime() - week1.getTime()) / 86400000;
  const weekNo = 1 + Math.round((diff - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

/** Mois au format « 2026-07 ». */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** « 8 – 14 juil. » — la semaine (lundi → dimanche) contenant `d`. */
export function weekRangeLabel(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const fmt = (x: Date, withMonth: boolean) =>
    withMonth ? x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : String(x.getDate());
  return `${fmt(monday, monday.getMonth() !== sunday.getMonth())} – ${fmt(sunday, true)}`;
}
