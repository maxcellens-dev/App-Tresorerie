/**
 * Les choix de Pico : les recommandations EXISTANTES, présentées comme des gestes à faire dans sa
 * banque.
 *
 * Relyka ne déplace jamais d'argent : il conseille un virement, l'utilisateur le fait dans son appli
 * bancaire, puis l'enregistre dans Relyka (ou le met de côté pour plus tard — pré-épargne et
 * pré-invest existants). Ce module ne recalcule RIEN : il reprend les recommandations telles que le
 * moteur les produit (`computeRecommendations`, dont les pourcentages viennent de
 * `deriveRecoAllocations`), avec leur `actionAmount` — le montant déjà retenu pour les actions, qui
 * ne pousse jamais à déplacer de l'argent incertain — et leur `recurringFit`.
 *
 * Aucune destination nouvelle n'est inventée : quatre types de recommandation, quatre choix.
 */
import type { RecoType, RecurringFit } from '../finance/recommendationEngine';
import type { TreePart } from './lexicon';

/** Ce dont ce module a besoin d'une recommandation (sous-ensemble de SmartRecommendation). */
export interface RecoLike {
  type: RecoType;
  actionAmount: number;
  recurringFit?: RecurringFit;
}

export interface ChoiceAccounts {
  /** Compte de départ des virements (compte courant principal). */
  from?: string | null;
  /** Compte d'épargne de destination (le livret d'épargne). */
  savingsTo?: string | null;
  /** Compte de placement de destination. */
  investTo?: string | null;
}

export interface PicoChoice {
  type: RecoType;
  /** Partie de l'arbre que ce choix nourrit. */
  part: Extract<TreePart, 'roots' | 'branches' | 'flowers' | 'can'>;
  amount: number;
  /** `transfer` = un virement à faire dans sa banque ; `info` = rien à faire (confort, ce qu'on garde). */
  kind: 'transfer' | 'info';
  from: string | null;
  to: string | null;
  /** La phrase de Pico. */
  text: string;
  /**
   * Conseil de virement permanent (existant : `recurringFit` « sustainable ») — le montant mensuel
   * tenable sans entamer la marge. Absent = pas de conseil.
   */
  permanentMonthly: number | null;
}

const ORDER: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];
const PART: Record<RecoType, PicoChoice['part']> = { save: 'roots', invest: 'branches', enjoy: 'flowers', keep: 'can' };

export function formatEuros(n: number, symbol = '€'): string {
  const v = Math.round(Math.abs(n));
  return `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${symbol}`;
}

export function buildPicoChoices(recos: RecoLike[], accounts: ChoiceAccounts = {}, symbol = '€'): PicoChoice[] {
  const from = accounts.from?.trim() || null;
  const fromLabel = from ?? 'ton compte courant';
  return ORDER.flatMap((type): PicoChoice[] => {
    const r = recos.find((x) => x.type === type);
    const amount = r && Number.isFinite(r.actionAmount) ? Math.round(r.actionAmount) : 0;
    if (!r || amount <= 0) return [];
    const eur = formatEuros(amount, symbol);
    const permanentMonthly = r.recurringFit?.kind === 'sustainable' && r.recurringFit.monthly > 0 ? Math.round(r.recurringFit.monthly) : null;

    if (type === 'save') {
      const to = accounts.savingsTo?.trim() || null;
      return [{ type, part: PART[type], amount, kind: 'transfer' as const, from, to, permanentMonthly, text: `Vire ${eur} de ${fromLabel} vers ${to ?? 'ton épargne'}.` }];
    }
    if (type === 'invest') {
      const to = accounts.investTo?.trim() || null;
      return [{ type, part: PART[type], amount, kind: 'transfer' as const, from, to, permanentMonthly, text: `Verse ${eur} sur ${to ?? 'tes placements'}.` }];
    }
    if (type === 'enjoy') {
      return [{ type, part: PART[type], amount, kind: 'info' as const, from: null, to: null, permanentMonthly: null, text: `${eur} pour toi ce mois-ci, profite.` }];
    }
    return [{ type, part: PART[type], amount, kind: 'info' as const, from: null, to: null, permanentMonthly: null, text: `${eur} restent sur ton compte.` }];
  });
}

/** Phrase du conseil de virement permanent, quand il s'applique. */
export function permanentTransferHint(c: PicoChoice, symbol = '€'): string | null {
  if (c.kind !== 'transfer' || c.permanentMonthly == null) return null;
  return `Ce montant revient chaque mois : programme un virement permanent de ${formatEuros(c.permanentMonthly, symbol)} dans ta banque.`;
}
