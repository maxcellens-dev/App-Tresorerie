// Module Crédit — calcul d'amortissement déterministe (mensualités constantes).
//
// Mensualité M = C·t / (1 − (1+t)^−n)   (C = capital, t = taux mensuel, n = nb d'échéances)
// Chaque mois : intérêts = CRD·t ; capital_remboursé = M − intérêts ; CRD' = CRD − capital_remboursé.
// Gère le différé (partiel = intérêts seuls, total = rien) et l'assurance (ajoutée à la mensualité).
// (Les remboursements anticipés / changements de taux via credit_events sont une évolution ultérieure.)

export interface CreditParams {
  principal: number;
  rate_annual: number;        // %
  duration_months: number;
  first_payment_date?: string | null;
  start_date: string;
  insurance_monthly?: number | null;
  deferral_months?: number | null;
  deferral_type?: 'none' | 'partial' | 'total' | null;
  /** #5 — assurance MENSUELLE par année (index 0 = année 1…). Manquant → insurance_monthly. */
  insurance_yearly?: (number | null)[] | null;
  /** #6 — mensualité (capital+intérêts) FORCÉE par année. Manquant/null → calcul standard. */
  payment_yearly?: (number | null)[] | null;
  /** C5 — événements (remboursement anticipé, changement de taux) appliqués chronologiquement. */
  events?: CreditEvent[] | null;
  /** Overrides MANUELS par échéance (édition du tableau, toutes colonnes) :
   *  p = mensualité hors assurance, i = assurance, int = intérêts, cap = capital, rd = restant dû, d = date. */
  schedule_overrides?: Record<string, { p?: number | null; i?: number | null; int?: number | null; cap?: number | null; rd?: number | null; d?: string | null }> | null;
}

export interface CreditEvent {
  date: string;                 // ISO
  kind: 'early_repayment' | 'rate_change' | 'modulation' | 'fee' | 'penalty';
  amount?: number | null;       // early_repayment : capital remboursé par anticipation
  new_rate?: number | null;     // rate_change : nouveau taux annuel (%)
  new_payment?: number | null;  // modulation : nouvelle mensualité
}

/** Indice d'année (0-based) d'une échéance (1-based). */
function yearIndex(period: number): number { return Math.floor((period - 1) / 12); }

/**
 * #8b — Mensualité SEMI-FIXE par PALIERS. Chaque palier commence à une année donnée et a une mensualité
 * FIXE. Une mensualité vide est AUTO-calculée pour amortir le capital restant dû au début du palier sur la
 * durée restante du prêt. Renvoie un tableau `payment_yearly` (mensualité forcée par année) prêt pour
 * computeAmortization, et les mensualités résolues par palier (pour l'affichage).
 */
export function resolvePaliers(
  C: number, rateAnnual: number, n: number,
  segments: { startYear: number; payment?: number | null }[],
): { paymentYearly: (number | null)[]; resolved: number[] } {
  const t = (rateAnnual || 0) / 100 / 12;
  const years = Math.max(1, Math.ceil(n / 12));
  const sorted = [...segments].filter((s) => s.startYear >= 0).sort((a, b) => a.startYear - b.startYear);
  if (sorted.length === 0 || sorted[0].startYear !== 0) sorted.unshift({ startYear: 0 });
  const out: (number | null)[] = Array(years).fill(null);
  const resolved: number[] = [];
  let crd = Math.max(0, C);
  for (let si = 0; si < sorted.length; si++) {
    const startMonth = Math.max(0, Math.round(sorted[si].startYear * 12));
    const endMonth = si + 1 < sorted.length ? Math.round(sorted[si + 1].startYear * 12) : n;
    const segMonths = endMonth - startMonth;
    if (segMonths <= 0) { resolved.push(0); continue; }
    let pay = sorted[si].payment;
    if (pay == null || Number.isNaN(pay) || pay <= 0) {
      const remaining = n - startMonth;
      pay = t > 0 ? (crd * t) / (1 - Math.pow(1 + t, -remaining)) : crd / Math.max(1, remaining);
    }
    resolved.push(Math.round(pay));
    for (let y = Math.floor(startMonth / 12); y < Math.ceil(endMonth / 12) && y < years; y++) out[y] = Math.round(pay);
    for (let m = 0; m < segMonths; m++) { const interest = crd * t; crd = Math.max(0, crd - (pay - interest)); }
  }
  return { paymentYearly: out, resolved };
}

export interface AmortRow {
  period: number;             // n° d'échéance (1..n)
  date: string;               // ISO (YYYY-MM-DD)
  payment: number;            // mensualité hors assurance
  insurance: number;          // part assurance
  interest: number;           // part intérêts
  principalPart: number;      // part capital
  crdAfter: number;           // capital restant dû après cette échéance
}

export interface AmortResult {
  monthlyPayment: number;     // mensualité « hors différé » (capital+intérêts), hors assurance
  monthlyWithInsurance: number;
  totalInterest: number;
  totalInsurance: number;
  totalCost: number;          // intérêts + assurance (coût du crédit)
  schedule: AmortRow[];
  /** Capital restant dû à une date donnée (la 1ʳᵉ échéance > date). */
  crdAtDate: (isoDate: string) => number;
  /** Nb d'échéances déjà passées à une date donnée. */
  paidCountAtDate: (isoDate: string) => number;
}

export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, (m - 1) + months, 1));
  const day = Math.min(d, new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate());
  base.setUTCDate(day);
  return base.toISOString().slice(0, 10);
}

export function computeAmortization(p: CreditParams): AmortResult {
  const C = Math.max(0, Number(p.principal) || 0);
  const n = Math.max(1, Math.round(Number(p.duration_months) || 1));
  const t = (Number(p.rate_annual) || 0) / 100 / 12; // taux mensuel
  const ins = Math.max(0, Number(p.insurance_monthly) || 0);
  const defN = Math.max(0, Math.round(Number(p.deferral_months) || 0));
  const defType = p.deferral_type ?? 'none';
  // La 1ʳᵉ échéance EST la date saisie (plus de décalage à m+1) : period 1 = first_payment_date (sinon start_date).
  const firstDate = p.first_payment_date && /^\d{4}-\d{2}-\d{2}$/.test(p.first_payment_date)
    ? p.first_payment_date
    : p.start_date;

  // Mensualité hors différé sur le nombre d'échéances « amortissantes » restant après le différé.
  const amortN = Math.max(1, n - defN);
  const monthlyPayment = t > 0
    ? (C * t) / (1 - Math.pow(1 + t, -amortN))
    : C / amortN;

  const schedule: AmortRow[] = [];
  let crd = C;
  let totalInterest = 0;
  let totalInsurance = 0;

  const insYearly = p.insurance_yearly ?? null;
  const payYearly = p.payment_yearly ?? null;
  const insForPeriod = (i: number) => {
    const y = insYearly?.[yearIndex(i)];
    return y != null && !Number.isNaN(y) ? Math.max(0, y) : ins;
  };
  const payOverride = (i: number) => {
    const y = payYearly?.[yearIndex(i)];
    return y != null && !Number.isNaN(y) && y > 0 ? y : null;
  };

  // C5 — événements triés par date (remboursement anticipé, changement de taux, modulation).
  const events = (p.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let evIdx = 0;
  let tCur = t;                 // taux mensuel courant (modifiable par rate_change)
  let modPayment: number | null = null; // mensualité forcée par une modulation

  const ov = (i: number) => p.schedule_overrides?.[String(i)];
  const onum = (v: number | null | undefined) => (v != null && !Number.isNaN(v) ? v : undefined);

  for (let i = 1; i <= n; i++) {
    const so = ov(i);
    const date = (so?.d && /^\d{4}-\d{2}-\d{2}$/.test(so.d)) ? so.d : addMonthsISO(firstDate, i - 1);
    // Appliquer les événements dont la date est <= date de cette échéance.
    while (evIdx < events.length && events[evIdx].date <= date) {
      const ev = events[evIdx++];
      if (ev.kind === 'early_repayment' && ev.amount) crd = Math.max(0, crd - Math.abs(ev.amount));
      else if (ev.kind === 'rate_change' && ev.new_rate != null) tCur = (Number(ev.new_rate) || 0) / 100 / 12;
      else if (ev.kind === 'modulation' && ev.new_payment != null) modPayment = Number(ev.new_payment) || null;
    }
    if (crd <= 0.005 && !(i <= defN)) break; // crédit soldé (ex. après remboursement anticipé total)

    // Overrides MANUELS de cette échéance (édition du tableau, toutes colonnes) : priment sur le calcul.
    const interest = onum(so?.int) ?? (tCur > 0 ? crd * tCur : 0);
    const insI = onum(so?.i) != null ? Math.max(0, onum(so?.i)!) : insForPeriod(i);
    let payment: number;
    let principalPart: number;
    const inDeferral = i <= defN;

    if (onum(so?.cap) != null) {
      // Capital forcé manuellement → la mensualité suit (sauf si forcée aussi).
      principalPart = onum(so?.cap)!;
      payment = onum(so?.p) ?? (principalPart + interest);
    } else if (onum(so?.p) != null) {
      // Mensualité (hors assurance) forcée manuellement pour cette échéance.
      payment = Math.max(0, onum(so?.p)!);
      principalPart = payment - interest;
      if (principalPart > crd && onum(so?.rd) == null) { principalPart = crd; payment = principalPart + interest; }
    } else if (inDeferral && defType === 'total') {
      payment = 0;
      principalPart = -interest; // CRD augmente des intérêts non payés
    } else if (inDeferral && defType === 'partial') {
      payment = interest;
      principalPart = 0;
    } else {
      // Priorité : modulation > mensualité forcée par année (#6) > mensualité standard.
      payment = modPayment ?? payOverride(i) ?? monthlyPayment;
      principalPart = payment - interest;
      if (i === n || principalPart > crd) { principalPart = crd; payment = principalPart + interest; }
    }

    // Restant dû : override manuel sinon calcul.
    crd = onum(so?.rd) != null ? Math.max(0, onum(so?.rd)!) : Math.max(0, crd - principalPart);
    totalInterest += Math.max(0, interest);
    totalInsurance += insI;
    schedule.push({ period: i, date, payment, insurance: insI, interest: Math.max(0, interest), principalPart, crdAfter: crd });
  }

  const crdAtDate = (isoDate: string) => {
    // CRD = capital après la dernière échéance dont la date <= isoDate (sinon capital initial).
    let v = C;
    for (const r of schedule) { if (r.date <= isoDate) v = r.crdAfter; else break; }
    return v;
  };
  const paidCountAtDate = (isoDate: string) => schedule.filter((r) => r.date <= isoDate).length;

  return {
    monthlyPayment,
    monthlyWithInsurance: monthlyPayment + insForPeriod(Math.min(defN + 1, n)),
    totalInterest,
    totalInsurance,
    totalCost: totalInterest + totalInsurance,
    schedule,
    crdAtDate,
    paidCountAtDate,
  };
}
