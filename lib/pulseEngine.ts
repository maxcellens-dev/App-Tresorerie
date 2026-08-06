/**
 * L'ÉTAT DES LIEUX — moteur pur.
 * ──────────────────────────────
 * Une VISION du mois écoulé : des constats chiffrés, posés côte à côte. Rien d'autre.
 *
 * ⚠️ CE MOTEUR NE JUGE PAS. Il n'y a ni statut, ni couleur d'état, ni « repère » à atteindre :
 * pas de vert / orange / rouge, pas de pastille « Bien parti » ou « Trop juste », pas de note
 * globale. L'utilisateur lit ce qui s'est passé ; c'est le reste de l'app (Pilotage,
 * recommandations, projection) qui l'aide à décider quoi en faire.
 *
 * Deux temps, un seul moteur :
 *   • live    — après chaque saisie : la carte de confirmation (cf. lib/pulseDelta) ;
 *   • mensuel — « État des lieux », offert une fois les clôtures faites.
 *
 * RÈGLES D'ÉCRITURE DES SIGNAUX (non négociables) :
 *   1. Chaque signal se lit d'un coup d'œil, sans jargon : pas de « rythme », pas de « % du rythme
 *      prévu ». On dit un MONTANT et sur quoi il porte.
 *   2. Tout pourcentage est accompagné de sa base en euros (« 14 % de tes revenus (1 500 €) »).
 *   3. Le signal montre AUSSI où on en est en valeur absolue (total épargné, solde…), pas
 *      seulement une progression.
 *   4. L'état des lieux est un ÉTAT, pas un menu : aucun bouton d'action dans les signaux.
 *
 * FIABILITÉ : quand la confiance est basse (confidenceEngine), le bilan est marqué « estimé » —
 * les chiffres restent affichés (ils ont une valeur indicative), avec une mention qui le dit.
 */

import type { FinancialProfileId } from '../types/database';
import { computeSecurityCushion, securityMonthsLabel, type SecurityCushionBase } from './securityCushion';

/* ── Signaux ─────────────────────────────────────────────────── */

/**
 * « Épargne du mois » et « Investissement du mois » n'existent PLUS comme signaux : l'anneau du
 * bilan et sa légende (mis de côté · placé · conservé) disent déjà ces montants, juste au-dessus.
 */
export type PulseSignalId =
  | 'end_of_month'    // « Fin de mois » : ce qu'il restera au 1er, vs la marge de sécurité
  | 'spending'        // « Dépenses variables » : dépensé vs budget variable habituel
  | 'cushion'         // « Matelas de sécurité » : combien de temps tenir sans revenus
  | 'no_overdraft'    // « Jamais dans le rouge » : mois consécutifs sans découvert
  | 'wealth'          // « Ton patrimoine » : total + évolution sur 3 mois
  | 'projects';       // « Tes projets » : le projet perso le plus avancé

export const PULSE_SIGNAL_IDS: PulseSignalId[] = [
  'end_of_month', 'spending', 'cushion', 'no_overdraft', 'wealth', 'projects',
];

/** Libellés admin (liste de sélection des signaux par profil). */
export const PULSE_SIGNAL_LABELS: Record<PulseSignalId, string> = {
  end_of_month: 'Fin de mois (ce qu’il restera)',
  spending:     'Dépenses variables',
  cushion:      'Matelas de sécurité',
  no_overdraft: 'Jamais dans le rouge',
  wealth:       'Patrimoine',
  projects:     'Projets perso',
};

export interface PulseSignal {
  id: PulseSignalId;
  /** Titre court, sans jargon. */
  label: string;
  /** Emoji du signal (identité visuelle rapide). */
  emoji: string;
  /** LA phrase du signal : un montant, ce qu'il représente. Ex. « Il te restera 512 € le 1er août ». */
  headline: string;
  /** La précision utile (palier, base du %, échéance…). Une phrase, jamais deux. */
  detail?: string;
  /** Où on en est en valeur absolue. Ex. « Épargne totale : 3 400 € ». */
  amountLine?: string;
  /** Part remplie de la barre (0..1). Absente = pas de barre. Aucun « repère » à atteindre. */
  progress?: number;
}

/* ── Configuration (admin) ───────────────────────────────────── */

export interface PulseConfig {
  enabled: boolean;
  /** Carte de confirmation après chaque saisie. */
  live: boolean;
  /** Rendez-vous mensuel (l'état des lieux du mois écoulé). */
  monthly: boolean;
  /** Signaux retenus, par profil, dans l'ordre d'affichage. */
  signalsByProfile: Record<FinancialProfileId, PulseSignalId[]>;
}

/**
 * Défauts : « Dépenses variables » et « Matelas de sécurité » sont toujours au bilan (ils ouvrent
 * la carte de récapitulatif) ; le reste varie avec le profil — le patrimoine ne parle qu'à ceux
 * qui en ont un (P4/P5). Les PROJETS PERSO sont présents pour TOUS les profils (décision produit).
 */
export const DEFAULT_PULSE_SIGNALS: Record<FinancialProfileId, PulseSignalId[]> = {
  P1: ['spending', 'cushion', 'end_of_month', 'no_overdraft', 'projects'],
  P2: ['spending', 'cushion', 'end_of_month', 'no_overdraft', 'projects'],
  P3: ['spending', 'cushion', 'end_of_month', 'no_overdraft', 'projects'],
  P4: ['spending', 'cushion', 'wealth', 'no_overdraft', 'projects'],
  P5: ['spending', 'cushion', 'wealth', 'no_overdraft', 'projects'],
};

export const DEFAULT_PULSE_CONFIG: PulseConfig = {
  enabled: true,
  live: true,
  monthly: true,
  signalsByProfile: DEFAULT_PULSE_SIGNALS,
};

/** Fusionne la config stockée (admin) avec les défauts — une config partielle reste valide. */
export function resolvePulseConfig(stored: Partial<PulseConfig> | null | undefined): PulseConfig {
  if (!stored) return DEFAULT_PULSE_CONFIG;
  const profiles: FinancialProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5'];
  const signalsByProfile = {} as Record<FinancialProfileId, PulseSignalId[]>;
  for (const p of profiles) {
    const raw = stored.signalsByProfile?.[p];
    // Garde-fou : une config stockée peut contenir un signal retiré du code → on le filtre.
    const kept = Array.isArray(raw) ? raw.filter((s) => PULSE_SIGNAL_IDS.includes(s)) : null;
    signalsByProfile[p] = kept && kept.length > 0 ? kept : DEFAULT_PULSE_SIGNALS[p];
  }
  return {
    enabled: stored.enabled ?? DEFAULT_PULSE_CONFIG.enabled,
    live: stored.live ?? DEFAULT_PULSE_CONFIG.live,
    monthly: stored.monthly ?? DEFAULT_PULSE_CONFIG.monthly,
    signalsByProfile,
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

  // Dépenses variables
  /** Budget variable habituel du mois. 0 = pas encore estimable. */
  spendingBudget: number;
  /** Dépensé en variable sur le mois concerné. */
  spendingSoFar: number;

  // Épargne / matelas
  /** Total sur les comptes d'épargne. */
  savingsBalance: number;
  /** Revenu mensuel moyen constaté (0 = non détecté). */
  avgMonthlyIncome: number;
  /** Tranche de revenu du questionnaire (repli du matelas tant qu'aucune recette n'est constatée). */
  questionnaireQ3?: string | null;

  // Patrimoine
  totalWealth: number;
  /** Patrimoine 3 mois plus tôt (snapshot). null = pas encore d'historique. */
  wealth3mAgo: number | null;

  // Séries
  /** Mois consécutifs terminés sans découvert. */
  monthsWithoutOverdraft: number;

  // Projets perso
  projects: { id: string; name: string; target: number; saved: number; progressPct: number }[];

  /** Confiance basse → le bilan est marqué « estimé » (chiffres indicatifs). */
  lowConfidence: boolean;
}

export interface PulseResult {
  signals: PulseSignal[];
  /** Chiffres non fiables → le bilan s'affiche en « estimé ». */
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

/* ── Construction de chaque signal ───────────────────────────── */

function buildEndOfMonth(i: PulseInputs): PulseSignal {
  const left = i.endOfMonthBalance;
  const margin = Math.max(0, i.safetyMargin);
  const above = left - margin;

  // Une PROJECTION se dit toujours au conditionnel (« devrais », « passerais ») : rien n'est acquis.
  const detail = margin > 0
    ? (above >= 0
        ? `Tu devrais être ${eur(above)} au-dessus de ta marge de sécurité (${eur(margin)}).`
        : `Tu devrais passer sous ta marge de sécurité (${eur(margin)}).`)
    : (left >= 0
        ? 'Ton compte devrait rester dans le vert jusqu’au bout du mois.'
        : 'Ton compte passerait dans le rouge avant la fin du mois.');

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
    headline: left >= 0
      ? `Il devrait te rester ${eur(left)} ${firstOfNextMonthLabel(i.today)}`
      : `Tu serais à ${eur(left)} ${firstOfNextMonthLabel(i.today)}`,
    detail,
    amountLine,
  };
}

/**
 * DÉPENSES VARIABLES — un CONSTAT, jamais une projection.
 *
 * L'état des lieux se lit après la clôture, donc sur un mois TERMINÉ : parler de « rythme » ou de
 * « à ce rythme tu finirais le mois vers X » n'a plus aucun sens (et c'était calculé sur la part
 * écoulée du mois EN COURS, pas du mois raconté). On compare simplement le dépensé au budget
 * variable habituel, et on dit l'écart.
 */
function buildSpending(i: PulseInputs): PulseSignal {
  const budget = Math.max(0, i.spendingBudget);
  const spent = Math.max(0, i.spendingSoFar);

  // Pas de budget variable estimable (nouvel utilisateur) → on montre le montant, sans comparaison.
  if (budget <= 0) {
    return {
      id: 'spending', label: 'Dépenses variables', emoji: '🛒',
      headline: `${eur(spent)} de dépenses variables`,
      detail: 'Encore un peu de suivi et Relyka saura situer ce montant par rapport à tes habitudes.',
    };
  }

  const diff = spent - budget;
  return {
    id: 'spending',
    label: 'Dépenses variables',
    emoji: '🛒',
    // « habituel » (pas « prévu ») : l'enveloppe variable est une ESTIMATION, pas un plan.
    headline: `${eur(spent)} dépensés sur les ${eur(budget)} habituels`,
    detail: diff > 0
      ? `Soit ${eur(diff)} de plus que ton budget variable habituel.`
      : diff < 0
        ? `Soit ${eur(-diff)} de moins que ton budget variable habituel.`
        : 'Exactement ton budget variable habituel.',
    progress: Math.min(1, spent / budget),
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

function buildCushion(i: PulseInputs): PulseSignal {
  const cushion = computeSecurityCushion({
    availableSavings: i.savingsBalance,
    avgMonthlyIncome: i.avgMonthlyIncome,
    questionnaireQ3: i.questionnaireQ3,
  });

  // Aucune base de revenu : on montre le montant épargné, sans le convertir en « mois ».
  if (cushion.months == null) {
    return {
      id: 'cushion', label: 'Matelas de sécurité', emoji: '🛟',
      headline: `${eur(i.savingsBalance)} d’épargne de côté`,
      detail: 'Ajoute ton revenu pour savoir combien de temps tu tiendrais sans rentrée d’argent.',
    };
  }

  const months = cushion.months;
  const base: SecurityCushionBase = cushion.base ?? 'income';

  // Prochain palier chiffré : « 6 mois (12 723 € / ~15 237 €) » — épargne actuelle / épargne visée.
  // La cible est le nb de mois × le revenu de référence (reference = épargne ÷ mois couverts).
  const next = nextCushionMilestone(months);
  const approx = base === 'income' ? '' : ' (estimation)';
  const detail = next
    ? `Prochain palier : ${next} mois${approx} (${eur(i.savingsBalance)} / ~${eur(next * cushion.reference)}).`
    : `Tu as de quoi voir venir (${eur(i.savingsBalance)} d'épargne)${approx}.`;

  return {
    id: 'cushion',
    label: 'Matelas de sécurité',
    emoji: '🛟',
    headline: `Tu pourrais tenir ${securityMonthsLabel(months)} sans rentrée d’argent`,
    detail,
    // La barre se remplit vers le PROCHAIN palier ; tous franchis → pleine.
    progress: next ? Math.min(1, months / next) : 1,
  };
}

function buildNoOverdraft(i: PulseInputs): PulseSignal {
  const n = Math.max(0, i.monthsWithoutOverdraft);
  return {
    id: 'no_overdraft',
    label: 'Jamais dans le rouge',
    emoji: '✅',
    headline: n === 0
      ? 'Aucun mois complet passé au-dessus de zéro pour l’instant'
      : n === 1
        ? 'Le mois dernier, tu as fini dans le vert'
        : `${n} mois de suite sans jamais être dans le rouge`,
  };
}

function buildWealth(i: PulseInputs): PulseSignal {
  const total = i.totalWealth;
  const before = i.wealth3mAgo;

  if (before == null || before <= 0) {
    return {
      id: 'wealth', label: 'Ton patrimoine', emoji: '🌍',
      headline: `${eur(total)} au total`,
      detail: 'Tes comptes courants, ton épargne et tes investissements réunis. On te montrera son évolution dans quelques mois.',
    };
  }

  const diff = total - before;
  const changePct = (diff / before) * 100;

  return {
    id: 'wealth',
    label: 'Ton patrimoine',
    emoji: '🌍',
    headline: `${eur(total)} au total`,
    detail: diff === 0
      ? 'Stable depuis 3 mois.'
      : `${diff > 0 ? '+' : '−'}${eur(Math.abs(diff))} en 3 mois (${diff > 0 ? '+' : '−'}${pct(Math.abs(changePct))}).`,
    amountLine: 'Comptes courants + épargne + investissements',
  };
}

function buildProjects(i: PulseInputs): PulseSignal | null {
  if (i.projects.length === 0) return null;

  // Le projet le PLUS AVANCÉ : on montre où on en est, on ne classe pas les projets « en retard ».
  const p = [...i.projects].sort((a, b) => b.progressPct - a.progressPct)[0];
  const others = i.projects.length - 1;

  return {
    id: 'projects',
    label: i.projects.length > 1 ? 'Tes projets' : 'Ton projet',
    emoji: '🎯',
    headline: `${p.name} : ${eur(p.saved)} sur ${eur(p.target)}`,
    amountLine: others > 0
      ? `Et ${others} autre${others > 1 ? 's' : ''} projet${others > 1 ? 's' : ''} en cours`
      : undefined,
    progress: Math.min(1, p.progressPct / 100),
  };
}

/* ── Moteur ──────────────────────────────────────────────────── */

const BUILDERS: Record<PulseSignalId, (i: PulseInputs) => PulseSignal | null> = {
  end_of_month: buildEndOfMonth,
  spending: buildSpending,
  cushion: buildCushion,
  no_overdraft: buildNoOverdraft,
  wealth: buildWealth,
  projects: buildProjects,
};

/**
 * ORDRE DE L'ÉTAT DES LIEUX.
 *
 * Le bilan du mois se lit APRÈS la clôture, donc plusieurs jours (voire semaines) après la fin du
 * mois concerné. Dans ce contexte, les signaux qui parlent de « maintenant » (patrimoine à date,
 * jamais dans le rouge…) passent après ceux qui racontent le mois écoulé. On ouvre donc sur les
 * deux repères du mois — DÉPENSES VARIABLES et MATELAS DE SÉCURITÉ — présents quel que soit le
 * profil (ils composent la carte de récapitulatif). Viennent ensuite « Ton projet » (s'il y en a),
 * puis « Fin de mois », puis le reste de la sélection du profil.
 */
const MONTHLY_LEAD: PulseSignalId[] = ['spending', 'cushion'];

export function monthlyIds(profileIds: PulseSignalId[]): PulseSignalId[] {
  const rest = profileIds.filter(
    (id) => !MONTHLY_LEAD.includes(id) && id !== 'projects' && id !== 'end_of_month',
  );
  const projects = profileIds.includes('projects') ? (['projects'] as PulseSignalId[]) : [];
  const endOfMonth = profileIds.includes('end_of_month') ? (['end_of_month'] as PulseSignalId[]) : [];
  return [...new Set<PulseSignalId>([...MONTHLY_LEAD, ...projects, ...endOfMonth, ...rest])];
}

export function computePulse(
  inputs: PulseInputs,
  config: PulseConfig = DEFAULT_PULSE_CONFIG,
): PulseResult {
  const profileIds = config.signalsByProfile[inputs.profileId] ?? DEFAULT_PULSE_SIGNALS[inputs.profileId];

  const signals: PulseSignal[] = [];
  for (const id of monthlyIds(profileIds)) {
    const signal = BUILDERS[id]?.(inputs);
    if (signal) signals.push(signal);
  }

  return { signals, estimated: inputs.lowConfidence };
}

/* ── Clé de période ──────────────────────────────────────────── */

/** Mois au format « 2026-07 ». */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
