/**
 * Prévision de trésorerie « simplifiée » sur N mois.
 *
 * Reprend la logique de la Projection (onglet Projection → Trésorerie) pour pouvoir la
 * réutiliser hors de l'écran (ex. moteur de conseils « vague 2 » basé sur le futur).
 *
 * Pour chaque mois : revenus, dépenses prévues, dépenses variables estimées, autres sorties
 * (épargne / invest / projets), et le solde prévu de fin de mois (cumulatif).
 */

export interface ForecastMonth {
  year: number;
  month: number;
  label: string;
  income: number;     // revenus du mois (comptes courants, hors virements/régul)
  expense: number;    // dépenses prévues (valeur absolue)
  variable: number;   // dépenses variables estimées
  other: number;      // épargne / invest / projets (sorties)
  balance: number;    // solde prévu de fin de mois (cumulatif)
  isCurrent: boolean;
  startBalance: number; // solde de départ utilisé pour ce mois
}

interface ForecastParams {
  transactions: any[];
  accounts: any[];
  /** Estimation mensuelle des dépenses variables (pilotage.variable_envelope_initial). */
  variableMonthly: number;
  /** Reste variable estimé du mois en cours (pilotage.variable_envelope_remaining). */
  variableRemaining: number;
  /** Nombre de mois à projeter (mois courant inclus). Défaut : 6. */
  monthsCount?: number;
  /** Date de référence (défaut : maintenant). */
  now?: Date;
  /** Overrides mensuels (montant réel modifié d'une occurrence) — pour projeter le RÉEL, pas le figé. */
  monthOverrides?: { transaction_id: string; year: number; month: number; override_amount: number | null }[];
}

export function computeMonthlyForecast(params: ForecastParams): ForecastMonth[] {
  const { transactions, accounts, variableMonthly, variableRemaining } = params;
  const now = params.now ?? new Date();
  const monthsCount = params.monthsCount ?? 6;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const checkingIds = new Set(accounts.filter((a: any) => a.type === 'checking').map((a: any) => a.id));
  const accountTypeById: Record<string, string> = {};
  accounts.forEach((a: any) => { accountTypeById[a.id] = a.type; });
  const checkingBalance = accounts.filter((a: any) => a.type === 'checking').reduce((s: number, a: any) => s + Number(a.balance), 0);

  const onChecking = (t: any) => checkingIds.has(t.account_id);
  const isTransfer = (t: any) => !!t.linked_account_id;
  const isRegul = (t: any) => typeof t.note === 'string' && /r[ée]gul/i.test(t.note);
  const usable = (t: any) => onChecking(t) && !isTransfer(t) && !t.is_draft;
  // RENTRÉE réelle sur le courant depuis un compte NON courant (épargne, invest, externe) → à compter
  // comme une entrée (ex. virement d'épargne pour couvrir une grosse dépense). Entre courants = exclu.
  const isIncomingExternal = (t: any) =>
    onChecking(t) && !!t.linked_account_id && !t.is_draft && Number(t.amount) > 0
    && accountTypeById[t.linked_account_id] !== 'checking';

  // Overrides mensuels : montant réel d'une occurrence pour un mois donné (signe repris du modèle).
  const ovr: Record<string, number> = {};
  for (const o of params.monthOverrides ?? []) {
    if (o.override_amount != null) ovr[`${o.transaction_id}:${o.year}:${o.month}`] = Math.abs(Number(o.override_amount));
  }
  const realSigned = (t: any, year: number, month: number, base: number): number => {
    const o = ovr[`${t.id}:${year}:${month}`];
    return o != null ? (base < 0 ? -o : o) : base;
  };

  const isOtherOutflow = (t: any) => {
    const isChecking = onChecking(t);
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    if (t.linked_account_id && !isChecking) return false;
    const isProjectTx = !!t.project_id;
    if (isChecking && linkedType === 'savings' && isProjectTx) return true;
    if (isChecking && linkedType === 'savings') return true;
    if (isChecking && linkedType === 'investment') return true;
    if (isProjectTx && isChecking) return true;
    return false;
  };

  function recurrenceAmount(t: any, year: number, month: number): number {
    const rule = t.recurrence_rule;
    const start = new Date(t.date);
    const end = t.recurrence_end_date ? new Date(t.recurrence_end_date) : new Date(year + 5, 0, 1);
    const msStart = new Date(year, month - 1, 1);
    const msEnd = new Date(year, month, 0);
    if (start > msEnd || end < msStart) return 0;
    if (rule === 'monthly') return Number(t.amount);
    if (rule === 'quarterly') {
      const sm = start.getFullYear() * 12 + start.getMonth();
      const tm = year * 12 + (month - 1);
      return (tm - sm) % 3 === 0 && tm >= sm ? Number(t.amount) : 0;
    }
    if (rule === 'yearly') return start.getMonth() === month - 1 ? Number(t.amount) : 0;
    if (rule === 'weekly') {
      let count = 0; let d = new Date(start);
      while (d <= msEnd) { if (d >= msStart && d <= end) count++; d.setDate(d.getDate() + 7); }
      return count * Number(t.amount);
    }
    return 0;
  }

  const otherForMonth = (year: number, month: number, onlyRemaining: boolean) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let total = 0;
    for (const t of transactions) {
      if (!isOtherOutflow(t)) continue;
      const raw = Number(t.amount);
      if (raw >= 0) continue;
      const absAmt = Math.abs(raw);
      if (t.is_recurring && t.recurrence_rule) {
        const occ = recurrenceAmount(t, year, month);
        if (!occ) continue;
        if (onlyRemaining) {
          const recDay = new Date(t.date).getDate();
          if (!t.is_draft && recDay < now.getDate()) continue;
        }
        total += Math.abs(occ);
      } else if (t.date.startsWith(prefix)) {
        if (onlyRemaining) { if (!t.is_draft && t.date <= todayStr) continue; }
        total += absAmt;
      }
    }
    return total;
  };

  const months = Array.from({ length: monthsCount }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 1 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  });

  let runningBalance = checkingBalance;

  return months.map(({ year, month, label }, i) => {
    const isCurrent = i === 0;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let income = 0;
    let expense = 0;

    for (const t of transactions) {
      // Recettes/dépenses réelles (hors virements) + RENTRÉES depuis hors-courant (virement entrant).
      const external = isIncomingExternal(t);
      if (!usable(t) && !external) continue;
      const amt = Number(t.amount);
      let monthAmt: number;
      if (t.is_recurring && t.recurrence_rule) monthAmt = recurrenceAmount(t, year, month);
      else if (t.date.startsWith(prefix)) monthAmt = amt;
      else continue;
      if (monthAmt === 0) continue;
      monthAmt = realSigned(t, year, month, monthAmt); // montant RÉEL (override du mois si présent)
      if (external) { income += Math.abs(monthAmt); continue; } // rentrée d'épargne = entrée
      if (monthAmt > 0) { if (!isRegul(t)) income += monthAmt; }
      else { expense += monthAmt; }
    }

    const variable = isCurrent ? variableRemaining : variableMonthly;
    const other = otherForMonth(year, month, false);
    const otherRemaining = isCurrent ? otherForMonth(year, month, true) : other;
    const startBalance = runningBalance;

    if (isCurrent) {
      let upcoming = 0;
      for (const t of transactions) {
        const external = isIncomingExternal(t);
        if (!usable(t) && !external) continue;
        const amt = Number(t.amount);
        if (t.is_recurring && t.recurrence_rule) {
          const occ = realSigned(t, year, month, recurrenceAmount(t, year, month));
          const recDay = new Date(t.date).getDate();
          if (occ !== 0 && recDay >= now.getDate()) upcoming += external ? Math.abs(occ) : occ;
        } else if (t.date.startsWith(prefix) && t.date > todayStr) {
          const real = realSigned(t, year, month, amt);
          if (external) upcoming += Math.abs(real);
          else if (!(real > 0 && isRegul(t))) upcoming += real;
        }
      }
      runningBalance = checkingBalance + upcoming - variableRemaining - otherRemaining;
    } else {
      runningBalance += income + expense - variable - other;
    }

    return {
      year, month, label,
      income, expense: Math.abs(expense), variable, other,
      balance: runningBalance, isCurrent,
      startBalance: isCurrent ? checkingBalance : startBalance,
    };
  });
}
