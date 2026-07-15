/**
 * POULS — le « live » : ce qui bouge quand l'utilisateur enregistre une opération.
 * ──────────────────────────────────────────────────────────────────────────────
 * Après chaque saisie (dépense, recette, virement), on lui montre :
 *   1. l'EFFET DIRECT de son geste (« Épargne : +200 € ») — affiché immédiatement, sans attendre ;
 *   2. l'impact sur son RELYKA (la métrique n°1 de l'app) ;
 *   3. le SIGNAL du Pouls que ce geste vient de faire bouger — avec sa barre, son nouveau constat
 *      et son état. Une dépense montre l'enveloppe du mois, un virement d'épargne montre le matelas…
 *      Un seul signal : celui que l'opération concerne, jamais la liste complète.
 *
 * Rien ne disparaît tout seul : l'utilisateur ferme au tap ou en balayant vers le haut.
 */

import type { PulseResult, PulseStatus, PulseSignal, PulseSignalId } from './pulseEngine';

export type PulseAccountType = 'checking' | 'savings' | 'investment' | string;

export interface PulseOp {
  kind: 'expense' | 'income' | 'transfer';
  /** Montant POSITIF de l'opération. */
  amount: number;
  /** Dépense / recette : type du compte touché. */
  accountType?: PulseAccountType;
  /** Virement : types des comptes source et destination. */
  fromType?: PulseAccountType;
  toType?: PulseAccountType;
  /** Opération datée dans le futur (planifiée) — le solde d'aujourd'hui ne bouge pas encore. */
  isFuture?: boolean;
}

export interface PulseDeltaChip {
  key: string;
  text: string;
  tone: PulseStatus;
}

export interface PulseFeedback {
  chips: PulseDeltaChip[];
  /** Le signal que cette opération vient de faire bouger (null = rien de pertinent à montrer). */
  signal: PulseSignal | null;
}

const eur = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('fr-FR')} €`;

/** Libellé du compte touché — une plus-value saisie sur un compte d'investissement ne doit pas
 *  s'annoncer « Compte courant » (cas réel : saisie gain/perte depuis le détail de compte). */
const ACCOUNT_LABEL: Record<string, string> = {
  checking: 'Compte courant',
  savings: 'Épargne',
  investment: 'Investissement',
};

/** Effet direct : la phrase que l'utilisateur attend juste après avoir validé. */
function directChip(op: PulseOp): PulseDeltaChip {
  const amount = Math.abs(op.amount);
  const accountLabel = ACCOUNT_LABEL[op.accountType ?? ''] ?? 'Compte courant';

  if (op.kind === 'income') {
    return {
      key: 'direct',
      text: op.isFuture ? `Recette prévue : +${eur(amount)}` : `${accountLabel} : +${eur(amount)}`,
      tone: 'good',
    };
  }

  if (op.kind === 'expense') {
    // Sortie directe sur l'épargne ou l'invest (moins-value, retrait) : on nomme le compte.
    if (op.accountType === 'savings' || op.accountType === 'investment') {
      return { key: 'direct', text: `${accountLabel} : −${eur(amount)}`, tone: 'watch' };
    }
    // Constat, pas jugement : une dépense normale n'a pas à s'afficher en orange.
    // C'est le signal « Dépenses du mois » en dessous qui dit si ça dérape.
    return {
      key: 'direct',
      text: op.isFuture ? `Dépense prévue : −${eur(amount)}` : `Dépense : −${eur(amount)}`,
      tone: 'neutral',
    };
  }

  // Virement : ce qui compte, c'est OÙ va l'argent.
  if (op.toType === 'savings') return { key: 'direct', text: `Épargne : +${eur(amount)}`, tone: 'good' };
  if (op.toType === 'investment') return { key: 'direct', text: `Investi : +${eur(amount)}`, tone: 'good' };
  if (op.fromType === 'savings' || op.fromType === 'investment') {
    return {
      key: 'direct',
      text: `${eur(amount)} repris sur ton ${op.fromType === 'savings' ? 'épargne' : 'investissement'}`,
      tone: 'watch',
    };
  }
  // Courant → courant : l'argent ne quitte pas le budget du quotidien.
  return { key: 'direct', text: `${eur(amount)} déplacés — ton budget ne change pas`, tone: 'neutral' };
}

/**
 * Le Relyka, TOUJOURS affiché (c'est LA métrique que l'utilisateur suit) — juste sa nouvelle valeur,
 * sans l'écart (qui ferait doublon avec le montant de la transaction affiché à côté).
 * On l'affiche même si le montant n'a pas bougé : une dépense dans l'enveloppe variable ne change
 * pas le Relyka (elle était déjà budgétée), mais le voir stable est rassurant, pas déroutant.
 */
function relykaChip(before: number | null, after: number | null): PulseDeltaChip | null {
  if (after == null) return null;
  const diff = before != null ? Math.round(after) - Math.round(before) : 0;
  return {
    key: 'relyka',
    text: `Ton Relyka : ${eur(after)}`,
    tone: after <= 0 ? 'alert' : diff < 0 ? 'watch' : 'good',
  };
}

/**
 * Quel signal cette opération fait-elle bouger ? (par ordre de préférence — on prend le premier que
 * le profil de l'utilisateur affiche réellement : inutile de parler d'investissement à un débutant).
 */
function impactedSignalIds(op: PulseOp): PulseSignalId[] {
  // Opération DATÉE PLUS TARD : rien n'a encore bougé aujourd'hui (montrer « Investissement du
  // mois : rien de placé » juste après avoir planifié un virement serait contradictoire).
  // Seule la projection de fin de mois est déjà impactée.
  if (op.isFuture) return ['end_of_month'];

  if (op.kind === 'income') return ['end_of_month', 'spending'];
  if (op.kind === 'expense') return ['spending', 'end_of_month'];

  // Virement : la carte reflète OÙ va l'argent — épargne → « Épargne du mois », invest →
  // « Investissement du mois ». Courant → courant : rien ne bouge côté épargne/invest, on garde
  // « Fin de mois » (le seul repère pertinent d'un déplacement dans le budget du quotidien).
  if (op.toType === 'savings') return ['saving', 'cushion', 'end_of_month'];
  if (op.toType === 'investment') return ['investing', 'end_of_month'];
  if (op.fromType === 'savings' || op.fromType === 'investment') return ['cushion', 'end_of_month'];
  return ['end_of_month']; // courant → courant
}

const MAX_CHIPS = 3;

/**
 * Retour à afficher pour une opération. `before`/`after` = le Pouls avant et après la saisie
 * (null tant que les données ne sont pas revenues → on n'affiche que l'effet direct, toujours vrai).
 */
export function computeOpFeedback(
  op: PulseOp,
  before: PulseResult | null,
  after: PulseResult | null,
  relykaBefore: number | null,
  relykaAfter: number | null,
): PulseFeedback {
  const chips: PulseDeltaChip[] = [directChip(op)];

  const relyka = relykaChip(relykaBefore, relykaAfter);
  if (relyka) chips.push(relyka);

  let signal: PulseSignal | null = null;
  if (after) {
    for (const id of impactedSignalIds(op)) {
      const found = after.signals.find((s) => s.id === id);
      if (found) { signal = found; break; }
    }
    // Le geste a fait basculer un AUTRE signal (ex. une grosse dépense fait passer la fin de mois
    // dans le rouge) → on le dit aussi, en pastille : c'est exactement l'info qui doit alerter.
    if (before) {
      const beforeById = new Map(before.signals.map((s) => [s.id, s]));
      for (const s of after.signals) {
        if (chips.length >= MAX_CHIPS) break;
        if (s.id === signal?.id) continue;
        const prev = beforeById.get(s.id);
        if (!prev || prev.status === s.status) continue;
        if (s.status === 'estimated' || s.status === 'neutral') continue;
        chips.push({ key: `signal:${s.id}`, text: `${s.emoji} ${s.label} : ${s.chip}`, tone: s.status });
      }
    }
  }

  return { chips: chips.slice(0, MAX_CHIPS), signal };
}
