/**
 * Trésorerie simplifiée — soldes courants PRÉVUS sur 6 mois.
 * Extraite de l'écran Projection (TresoSimplified) pour être partagée avec le moteur de
 * recommandations (garde-fou marge de sécurité) : UNE seule trajectoire pour l'affichage
 * (courbe/cartes de la Projection) et pour le frein des recos épargne/invest.
 * Les virements récurrents courant ↔ épargne/invest sont inclus (« Autre », signé).
 */
import { recurringAmountForMonth } from './recurrenceMonth';
import { isRegul } from './regul';

export interface TresoMonthRow {
  year: number;
  month: number;
  label: string;
  /** Revenus du mois (comptes courants, hors virements/régul). */
  income: number;
  /** Dépenses récurrentes + réelles (valeur absolue). */
  expense: number;
  /** Dépenses variables estimées (reste du mois courant, enveloppe ensuite). */
  variable: number;
  /** Virements courant ↔ épargne/invest/projet, NET signé (sortie négative). */
  other: number;
  /** Solde courant prévu en fin de mois. */
  balance: number;
  isCurrent: boolean;
  /** Solde de départ (mois courant uniquement). */
  startBalance: number | null;
}

export interface TresoProjectionInput {
  /** Transactions du périmètre quotidien (devise de référence, virements partagés transformés). */
  transactions: any[];
  /** Comptes du périmètre (devise de référence). */
  accounts: any[];
  /** Overrides « échéance modifiée » : `${transactionId}:${year}:${month}` → montant FINAL signé. */
  overridesMap: Record<string, number>;
  /** Enveloppe variable mensuelle estimée. */
  variableMonthly: number;
  /** Reste d'enveloppe variable du mois courant. */
  variableRemaining: number;
  /** Nombre de mois projetés (mois courant inclus). Défaut : 6. */
  monthsCount?: number;
  now?: Date;
}

export function computeTresoRows(input: TresoProjectionInput): TresoMonthRow[] {
  const { transactions, accounts, overridesMap, variableMonthly, variableRemaining } = input;
  const now = input.now ?? new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Jour d'occurrence d'une récurrente DANS un mois donné, borné à la longueur du mois (une
  // récurrente du 31 tombe le 28/29 en février) — l'ancien `new Date(t.date).getDate()` brut
  // renvoyait 31 et faisait passer l'échéance pour « à venir » tout le mois.
  const occDayInMonth = (t: any, year: number, month: number): number => {
    const start = new Date(String(t.date ?? '').slice(0, 10) + 'T00:00:00');
    const dim = new Date(year, month, 0).getDate();
    return Math.min(start.getDate() || 1, dim);
  };
  // Une occurrence datée AUJOURD'HUI est PASSÉE (le solde du compte l'inclut déjà : le recalcul
  // serveur somme les transactions de date ≤ aujourd'hui). Le Pilotage applique la même règle
  // (`recurrencePastInMonth` : `occ <= todayStr`) — sans ça, les deux écrans divergeaient du
  // montant de l'échéance pendant toute la journée du prélèvement.
  const isOccPast = (t: any, year: number, month: number) => occDayInMonth(t, year, month) <= now.getDate();

  const checkingIds = new Set(accounts.filter((a: any) => a.type === 'checking').map((a: any) => a.id));
  const accountTypeById: Record<string, string> = {};
  accounts.forEach((a: any) => { accountTypeById[a.id] = a.type; });
  const checkingBalance = accounts.filter((a: any) => a.type === 'checking').reduce((s: number, a: any) => s + Number(a.balance), 0);

  // Filtres : on ne garde que les flux des comptes courants, hors virements internes,
  // hors régularisations et hors montants RÉSERVÉS (qui restent sur le compte → font partie du solde).
  const onChecking = (t: any) => checkingIds.has(t.account_id);
  const isTransfer = (t: any) => !!t.linked_account_id;
  /* Définition CANONIQUE (lib/finance/regul) — pas une regex locale sur la note.
     Celle qui vivait ici ne reconnaissait une régularisation qu'à son libellé : une régul saisie à
     la main peut n'avoir AUCUNE note et n'être identifiée que par `regul_target`. Elle entrait donc
     dans la projection comme une vraie recette ou une vraie dépense — et cette trajectoire est LA
     référence de l'app (courbe de Projection, soldes 12 mois du Pilotage, garde-fou de marge des
     recommandations). Une correction de solde y déformait tout ce qui en dépend. */
  // Virement synthétique vers/depuis un compte partagé « contribution » (périmètre) :
  //   • cible ÉPARGNE/INVEST partagée → « Autre (épargne, invest…) » comme un virement épargne classique ;
  //   • cible COURANTE (charges communes) → dépense/recette NORMALE (récurrent → dépenses prévues,
  //     ponctuel → comme toute transaction), exactement comme dans le Pilotage.
  const isSharedToSavInv = (t: any) => !!t._perimeter_synthetic
    && (t._shared_target_type === 'savings' || t._shared_target_type === 'investment');
  const usable = (t: any) => onChecking(t) && !isTransfer(t) && !t.is_draft && !t.is_reserved && !isSharedToSavInv(t);

  // « Autre » = virements entre le compte courant et l'épargne/investissement, DANS LES 2 SENS
  // (courant→épargne = sortie négative ; épargne→courant = entrée positive).
  // Les virements de PROJET comptent comme des virements planifiés, MÊME en brouillon (comme si on
  // les avait saisis manuellement). Les RÉSERVATIONS (is_reserved) et les autres brouillons ne comptent pas.
  const isOtherFlow = (t: any) => {
    if (t.is_reserved) return false;
    if (t.is_draft && !t.project_id) return false; // brouillons hors projet : exclus
    if (isSharedToSavInv(t)) return onChecking(t); // virement vers épargne/invest PARTAGÉE → « Autre »
    if (!onChecking(t)) return false; // on ne garde que la jambe côté compte courant
    if (!t.linked_account_id) return false; // doit être un virement (pas une réservation)
    const linkedType = accountTypeById[t.linked_account_id] ?? null;
    return linkedType === 'savings' || linkedType === 'investment';
  };

  // Échéance modifiée : un override remplace le montant calculé pour ce mois précis (signé), sinon
  // la Projection garderait le montant récurrent de base et ignorerait l'édition d'une échéance.
  // Arithmétique PARTAGÉE avec le Reporting (mois à venir) — cf. lib/recurrenceMonth.
  const recurrenceAmount = (t: any, year: number, month: number): number =>
    recurringAmountForMonth(t, year, month, overridesMap);

  // Renvoie le flux NET signé du mois (négatif = sortie d'épargne, positif = retour vers le courant).
  const otherForMonth = (year: number, month: number, onlyRemaining: boolean) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let total = 0;
    for (const t of transactions) {
      if (!isOtherFlow(t)) continue;
      const raw = Number(t.amount);
      if (raw === 0) continue;
      if (t.is_recurring && t.recurrence_rule) {
        const occ = recurrenceAmount(t, year, month);
        if (!occ) continue;
        if (onlyRemaining && !t.is_draft && isOccPast(t, year, month)) continue;
        total += occ; // signé
      } else if (t.date.startsWith(prefix)) {
        if (onlyRemaining) {
          if (!t.is_draft && t.date <= todayStr) continue;
        }
        total += raw; // signé
      }
    }
    return total;
  };

  const months = Array.from({ length: input.monthsCount ?? 6 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 1 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  });

  let runningBalance = checkingBalance;

  return months.map(({ year, month, label }, i) => {
    const isCurrent = i === 0;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let income = 0;   // revenus (comptes courants, hors virements/régul)
    let expense = 0;  // dépenses récurrentes + réelles (signe négatif)

    for (const t of transactions) {
      if (!usable(t)) continue;
      const amt = Number(t.amount);
      let monthAmt: number;
      if (t.is_recurring && t.recurrence_rule) monthAmt = recurrenceAmount(t, year, month);
      else if (t.date.startsWith(prefix)) monthAmt = amt;
      else continue;
      if (monthAmt === 0) continue;
      if (monthAmt > 0) { if (!isRegul(t)) income += monthAmt; }
      else { expense += monthAmt; }
    }

    // Dépenses variables : reste estimé pour le mois courant, estimation mensuelle ensuite.
    const variable = isCurrent ? variableRemaining : variableMonthly;
    const other = otherForMonth(year, month, false);
    const otherRemaining = isCurrent ? otherForMonth(year, month, true) : other;

    // Solde prévu (fin de mois). Mois courant : on ne reprojette que ce qui est encore à venir
    // (récurrences + ponctuels datés après aujourd'hui) pour ne pas double-compter le solde réel.
    if (isCurrent) {
      let upcoming = 0;
      for (const t of transactions) {
        if (!usable(t)) continue;
        const amt = Number(t.amount);
        if (t.is_recurring && t.recurrence_rule) {
          // Récurrence encore à venir = son jour d'occurrence n'est pas encore échu (aujourd'hui
          // compte comme PASSÉ, cf. `isOccPast` — même règle que le Pilotage et que le solde serveur).
          const occ = recurrenceAmount(t, year, month);
          if (occ !== 0 && !isOccPast(t, year, month)) upcoming += occ;
        } else if (t.date.startsWith(prefix) && t.date > todayStr) {
          if (!(amt > 0 && isRegul(t))) upcoming += amt;
        }
      }
      // `otherRemaining` est signé (sortie négative / entrée positive) → on l'AJOUTE.
      runningBalance = checkingBalance + upcoming - variableRemaining + otherRemaining;
    } else {
      runningBalance += income + expense - variable + other;
    }

    return {
      year, month, label, income, expense: Math.abs(expense), variable, other, balance: runningBalance, isCurrent,
      startBalance: isCurrent ? checkingBalance : null,
    };
  });
}
