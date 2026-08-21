// Module Crédit — calcul d'amortissement déterministe (mensualités constantes).
//
// Mensualité M = C·t / (1 − (1+t)^−n)   (C = capital, t = taux mensuel, n = nb d'échéances REMBOURSÉES)
// Chaque mois : intérêts = CRD·t ; capital_remboursé = M − intérêts ; CRD' = CRD − capital_remboursé.
//
// DIFFÉRÉ (franchise) : les mois de différé s'ajoutent EN TÊTE du tableau (duration_months reste le
// nombre d'échéances remboursées, comme sur le contrat). Trois comportements :
//   • partiel               : on paie les intérêts chaque mois pendant le différé ;
//   • total « capitalisés » : on ne paie rien, les intérêts s'ajoutent au capital (anatocisme) ;
//   • total « différés »    : on ne paie rien, les intérêts vont dans un compteur SÉPARÉ (le CRD ne bouge
//     pas) remboursé EN PRIORITÉ par les premières mensualités, avant tout amortissement du capital.
//     C'est la pratique courante des banques françaises (LCL, CA…) : la colonne « Total des intérêts
//     différés » de leur tableau. Validé au centime contre un échéancier LCL réel.
// `interim_interest` (saisie manuelle) remplace l'estimation automatique des intérêts du différé —
// utile quand le capital est débloqué par TRANCHES (l'estimation sur le capital total serait trop haute).

export interface CreditParams {
  principal: number;
  rate_annual: number;        // %
  duration_months: number;    // nb d'échéances REMBOURSÉES (hors différé)
  first_payment_date?: string | null;
  /** Date de 1ʳᵉ échéance d'ASSURANCE (peut différer du remboursement). NULL → first_payment_date. */
  first_insurance_date?: string | null;
  start_date: string;
  insurance_monthly?: number | null;
  deferral_months?: number | null;
  deferral_type?: 'none' | 'partial' | 'total' | null;
  /** Différé total : 'deferred' = intérêts NON capitalisés, remboursés en premier (banques FR) ;
   *  'capitalized' = ajoutés au capital. Défaut 'capitalized' (compatibilité crédits existants). */
  deferral_interest_mode?: 'capitalized' | 'deferred' | null;
  /** Intérêts intercalaires RÉELS (relevé banque). Si > 0 avec un différé, remplace l'estimation auto
   *  (indispensable si déblocage progressif par tranches). Sans différé : simple ligne de frais. */
  interim_interest?: number | null;
  /** #5 — assurance MENSUELLE par année (index 0 = année 1…). Manquant → insurance_monthly. */
  insurance_yearly?: (number | null)[] | null;
  /** #6 — mensualité (capital+intérêts) FORCÉE par année DE REMBOURSEMENT. Manquant/null → standard. */
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

/** Options de différé pour resolvePaliers (mêmes conventions que CreditParams). */
export interface DeferralOpts {
  months?: number | null;
  type?: 'none' | 'partial' | 'total' | null;
  interestMode?: 'capitalized' | 'deferred' | null;
  /** Intérêts intercalaires réels (remplace l'estimation auto). */
  seed?: number | null;
}

/** État initial au 1ᵉʳ mois REMBOURSÉ : CRD (capitalisé si différé total capitalisé) + stock
 *  d'intérêts différés D à rembourser en premier (différé total « deferred »). */
function deferralStart(C: number, t: number, defer?: DeferralOpts | null): { crd: number; D: number } {
  const defN = Math.max(0, Math.round(Number(defer?.months) || 0));
  if (defN <= 0 || !defer || defer.type !== 'total') return { crd: C, D: 0 };
  const seed = Math.max(0, Number(defer.seed) || 0); // intercalaires réels saisis (sinon estimation)
  if (defer.interestMode === 'deferred') return { crd: C, D: seed > 0 ? seed : C * t * defN };
  return { crd: seed > 0 ? C + seed : C * Math.pow(1 + t, defN), D: 0 };
}

/** Reste dû (CRD + intérêts différés) après `months` mensualités `pay` — sans clamp, pour la bisection. */
function residualAfter(crd0: number, D0: number, t: number, months: number, pay: number): number {
  let crd = crd0, D = D0;
  for (let m = 0; m < months; m++) {
    const interest = crd * t;
    const avail = pay - interest;
    const payDef = Math.min(D, Math.max(0, avail));
    D -= payDef;
    crd -= (avail - payDef);
  }
  return crd + D;
}

/** Mensualité qui solde CRD + intérêts différés sur `months` mois. Formule fermée sans stock différé,
 *  bisection sinon (le stock est remboursé en premier et ne porte pas intérêt → pas de formule simple). */
function solvePayment(crd0: number, D0: number, t: number, months: number): number {
  if (months <= 0) return 0;
  const annuity = t > 0 ? (crd0 * t) / (1 - Math.pow(1 + t, -months)) : crd0 / months;
  if (D0 <= 0) return annuity;
  let lo = 0, hi = annuity + D0 / months + 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (residualAfter(crd0, D0, t, months, mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * #8b — Mensualité SEMI-FIXE par PALIERS. Chaque palier commence à une année donnée (années DE
 * REMBOURSEMENT, hors différé) et a une mensualité FIXE. Une mensualité vide est AUTO-calculée pour
 * solder le prêt (capital + intérêts différés éventuels) sur la durée restante. Renvoie un tableau
 * `payment_yearly` prêt pour computeAmortization, et les mensualités résolues par palier (affichage).
 */
export function resolvePaliers(
  C: number, rateAnnual: number, n: number,
  segments: { startYear: number; payment?: number | null }[],
  defer?: DeferralOpts | null,
): { paymentYearly: (number | null)[]; resolved: number[] } {
  const t = (rateAnnual || 0) / 100 / 12;
  const years = Math.max(1, Math.ceil(n / 12));
  const sorted = [...segments].filter((s) => s.startYear >= 0).sort((a, b) => a.startYear - b.startYear);
  if (sorted.length === 0 || sorted[0].startYear !== 0) sorted.unshift({ startYear: 0 });
  const out: (number | null)[] = Array(years).fill(null);
  const resolved: number[] = [];
  let { crd, D } = deferralStart(Math.max(0, C), t, defer);
  for (let si = 0; si < sorted.length; si++) {
    const startMonth = Math.max(0, Math.round(sorted[si].startYear * 12));
    const endMonth = si + 1 < sorted.length ? Math.round(sorted[si + 1].startYear * 12) : n;
    const segMonths = endMonth - startMonth;
    if (segMonths <= 0) { resolved.push(0); continue; }
    let pay = sorted[si].payment;
    if (pay == null || Number.isNaN(pay) || pay <= 0) pay = solvePayment(crd, D, t, n - startMonth);
    // On GARDE les centimes (arrondi au centime, pas à l'euro) → le tableau affiche 987,43 et non 987,00.
    const pay2 = Math.round(pay * 100) / 100;
    resolved.push(pay2);
    for (let y = Math.floor(startMonth / 12); y < Math.ceil(endMonth / 12) && y < years; y++) out[y] = pay2;
    for (let m = 0; m < segMonths; m++) {
      const interest = crd * t;
      const avail = pay - interest;
      const payDef = Math.min(D, Math.max(0, avail));
      D -= payDef;
      crd = Math.max(0, crd - (avail - payDef));
    }
  }
  return { paymentYearly: out, resolved };
}

export interface AmortRow {
  period: number;             // n° d'échéance (1..defN+n, différé inclus)
  date: string;               // ISO (YYYY-MM-DD)
  payment: number;            // mensualité hors assurance
  insurance: number;          // part assurance
  interest: number;           // part intérêts PAYÉS (intérêts du mois + part d'intérêts différés remboursée)
  principalPart: number;      // part capital
  crdAfter: number;           // capital restant dû après cette échéance
  /** Stock d'intérêts différés restant à rembourser après cette échéance (différé « deferred »). */
  deferredAfter?: number;
}

export interface AmortResult {
  monthlyPayment: number;     // mensualité « hors différé » (capital+intérêts), hors assurance
  monthlyWithInsurance: number;
  totalInterest: number;
  totalInsurance: number;
  /** Intérêts INTERCALAIRES = intérêts courus pendant le différé (avant amortissement du capital).
   *  Déjà INCLUS dans totalInterest — exposé à part pour l'affichage (« comme les banques »). */
  deferralInterest: number;
  totalCost: number;          // intérêts + assurance (coût du crédit)
  schedule: AmortRow[];       // échéancier de REMBOURSEMENT (différé + n lignes, par période)
  /** Échéancier RÉEL fusionné (remboursement + assurance à leurs dates respectives, possiblement décalées
   *  → plus de lignes que la durée). Pour l'affichage du tableau. Une ligne peut n'avoir que l'assurance. */
  displaySchedule: AmortRow[];
  /** Capital restant dû à une date donnée (la 1ʳᵉ échéance > date). */
  crdAtDate: (isoDate: string) => number;
  /** Nb d'échéances déjà passées à une date donnée. */
  paidCountAtDate: (isoDate: string) => number;
}

/**
 * Montant de la PROCHAINE échéance à une date donnée (capital + intérêts + assurance).
 *
 * C'est ce montant-là qu'il faut annoncer comme « Mensualité », et non `monthlyWithInsurance` :
 * celui-ci est la mensualité NOMINALE, celle du plan théorique. Dès qu'il y a un différé, des
 * paliers, une modulation ou un remboursement anticipé, les deux diffèrent — et la liste des
 * crédits affichait déjà la prochaine échéance réelle là où la fiche du crédit montrait la
 * nominale : ouvrir une ligne changeait donc le chiffre qu'on venait de lire.
 *
 * Repli sur la nominale quand toutes les échéances sont passées (crédit soldé) : il n'y a plus de
 * « prochaine », mais on préfère un ordre de grandeur juste à un zéro trompeur.
 */
export function nextPaymentAtDate(
  a: Pick<AmortResult, 'schedule' | 'monthlyWithInsurance'>,
  isoDate: string,
): number {
  const next = a.schedule.find((r) => r.date > isoDate);
  return next ? next.payment + next.insurance : a.monthlyWithInsurance;
}

/**
 * Taux annuel EN VIGUEUR à une date (%), en tenant compte des événements `rate_change`.
 *
 * `credit.rate_annual` est le taux d'ORIGINE : l'afficher tel quel après une renégociation
 * contredisait l'échéancier juste en dessous, qui, lui, applique déjà le nouveau taux.
 * Même règle de bord que le moteur : un événement s'applique dès que sa date est atteinte.
 */
export function rateAtDate(
  p: { rate_annual?: number | null; events?: CreditEvent[] | null },
  isoDate: string,
): number {
  let cur = Number(p.rate_annual) || 0;
  const events = (p.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const ev of events) {
    if (ev.date > isoDate) break;
    if (ev.kind === 'rate_change' && ev.new_rate != null) cur = Number(ev.new_rate) || 0;
  }
  return cur;
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
  const defType = defN > 0 ? (p.deferral_type ?? 'none') : 'none';
  const defDeferred = defType === 'total' && p.deferral_interest_mode === 'deferred';
  const defSeed = Math.max(0, Number(p.interim_interest) || 0);
  // Accrual mensuel pendant le différé : intercalaires réels saisis (répartis) sinon CRD·t.
  const defAccrual = (crd: number, tt: number) => (defSeed > 0 ? defSeed / defN : crd * tt);
  const totalN = n + defN; // le différé s'ajoute EN TÊTE : n = nb d'échéances remboursées
  // La 1ʳᵉ échéance EST la date saisie (plus de décalage à m+1) : period 1 = first_payment_date (sinon start_date).
  const firstDate = p.first_payment_date && /^\d{4}-\d{2}-\d{2}$/.test(p.first_payment_date)
    ? p.first_payment_date
    : p.start_date;

  // Mensualité standard : solde le CRD au 1ᵉʳ mois remboursé (capitalisé si différé total capitalisé)
  // + le stock d'intérêts différés éventuel, sur les n échéances remboursées.
  const start = deferralStart(C, t, defType === 'none' ? null : { months: defN, type: defType, interestMode: defDeferred ? 'deferred' : 'capitalized', seed: defSeed });
  const monthlyPayment = solvePayment(start.crd, start.D, t, n);

  const schedule: AmortRow[] = [];
  let crd = C;
  let D = 0;                 // stock d'intérêts différés restant à rembourser (différé « deferred »)
  let totalInterest = 0;
  let totalInsurance = 0;
  let deferralInterest = 0;  // intérêts intercalaires (courus pendant le différé)

  const insYearly = p.insurance_yearly ?? null;
  const payYearly = p.payment_yearly ?? null;
  const insForPeriod = (i: number) => {
    // Année plafonnée à la dernière renseignée (le différé ajoute des lignes au-delà du tableau annuel).
    const y = insYearly?.[Math.min(yearIndex(i), Math.max(0, (insYearly?.length ?? 1) - 1))];
    return y != null && !Number.isNaN(y) ? Math.max(0, y) : ins;
  };
  // Mensualité forcée par année DE REMBOURSEMENT (j = i − defN) : les paliers sont pensés « an 1 = 1ʳᵉ
  // année remboursée », indépendamment du différé.
  const payOverride = (j: number) => {
    const y = payYearly?.[yearIndex(j)];
    return y != null && !Number.isNaN(y) && y > 0 ? y : null;
  };

  // C5 — événements triés par date (remboursement anticipé, changement de taux, modulation).
  const events = (p.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let evIdx = 0;
  let tCur = t;                 // taux mensuel courant (modifiable par rate_change)
  let modPayment: number | null = null; // mensualité forcée par une modulation

  const ov = (i: number) => p.schedule_overrides?.[String(i)];
  const onum = (v: number | null | undefined) => (v != null && !Number.isNaN(v) ? v : undefined);

  for (let i = 1; i <= totalN; i++) {
    const so = ov(i);
    const date = (so?.d && /^\d{4}-\d{2}-\d{2}$/.test(so.d)) ? so.d : addMonthsISO(firstDate, i - 1);
    // Appliquer les événements dont la date est <= date de cette échéance.
    while (evIdx < events.length && events[evIdx].date <= date) {
      const ev = events[evIdx++];
      if (ev.kind === 'early_repayment' && ev.amount) crd = Math.max(0, crd - Math.abs(ev.amount));
      else if (ev.kind === 'rate_change' && ev.new_rate != null) tCur = (Number(ev.new_rate) || 0) / 100 / 12;
      else if (ev.kind === 'modulation' && ev.new_payment != null) modPayment = Number(ev.new_payment) || null;
    }
    const inDeferral = i <= defN;
    if (crd <= 0.005 && D <= 0.005 && !inDeferral) break; // crédit soldé (ex. après remboursement anticipé total)

    const insI = onum(ov(i)?.i) != null ? Math.max(0, onum(so?.i)!) : insForPeriod(i);
    let payment: number;
    let interest: number;
    let principalPart: number;

    if (inDeferral && defDeferred) {
      // Différé total « intérêts différés » : rien payé, le compteur D grossit, le CRD ne bouge pas.
      const acc = defAccrual(crd, tCur);
      D += acc;
      deferralInterest += acc;
      payment = 0; interest = 0; principalPart = 0;
    } else if (inDeferral && defType === 'total') {
      // Différé total « capitalisés » : les intérêts s'ajoutent au capital.
      interest = defAccrual(crd, tCur);
      payment = 0;
      principalPart = -interest; // CRD augmente des intérêts non payés
      deferralInterest += interest;
      totalInterest += interest;
    } else if (inDeferral && defType === 'partial') {
      // Différé partiel : on paie les intérêts (intercalaires) chaque mois.
      interest = defAccrual(crd, tCur);
      payment = interest;
      principalPart = 0;
      deferralInterest += interest;
      totalInterest += interest;
    } else {
      // Échéance de REMBOURSEMENT (j = n° d'échéance remboursée). Le paiement couvre d'abord les
      // intérêts du mois, puis le stock d'intérêts différés, puis amortit le capital.
      const j = i - defN;
      const monthInterest = tCur > 0 ? crd * tCur : 0;

      // Overrides MANUELS de cette échéance (édition du tableau, toutes colonnes) : priment sur le calcul.
      if (onum(so?.cap) != null) {
        // Capital forcé manuellement → la mensualité suit (sauf si forcée aussi).
        principalPart = onum(so?.cap)!;
        interest = onum(so?.int) ?? monthInterest;
        payment = onum(so?.p) ?? (principalPart + interest);
        // Part d'intérêts différés implicitement remboursée = ce que la mensualité couvre au-delà.
        const payDef = Math.min(D, Math.max(0, payment - interest - principalPart));
        D -= payDef; interest += payDef;
      } else if (onum(so?.p) != null || onum(so?.int) != null) {
        // Mensualité et/ou intérêts forcés manuellement pour cette échéance.
        payment = Math.max(0, onum(so?.p) ?? (modPayment ?? payOverride(j) ?? monthlyPayment));
        const curInt = onum(so?.int) ?? monthInterest;
        const payDef = Math.min(D, Math.max(0, payment - curInt));
        D -= payDef;
        interest = curInt + payDef;
        principalPart = payment - interest;
        if (principalPart > crd && onum(so?.rd) == null) { principalPart = crd; payment = principalPart + interest; }
      } else {
        // Priorité : modulation > mensualité forcée par année (#6) > mensualité standard.
        payment = modPayment ?? payOverride(j) ?? monthlyPayment;
        const avail = payment - monthInterest;
        const payDef = Math.min(D, Math.max(0, avail));
        D -= payDef;
        interest = monthInterest + payDef;
        principalPart = avail - payDef;
        // Dernière échéance (ou dépassement) : on solde exactement le capital restant.
        if (j === n || principalPart > crd) { principalPart = crd; payment = principalPart + interest; }
      }
    }

    // Restant dû : override manuel sinon calcul.
    crd = onum(so?.rd) != null ? Math.max(0, onum(so?.rd)!) : Math.max(0, crd - principalPart);
    totalInterest += inDeferral ? 0 : Math.max(0, interest);
    totalInsurance += insI;
    schedule.push({
      period: i, date, payment, insurance: insI, interest: Math.max(0, interest), principalPart,
      crdAfter: crd, ...(defDeferred ? { deferredAfter: Math.max(0, Math.round(D * 100) / 100) } : {}),
    });
  }
  // Sécurité : stock d'intérêts différés jamais remboursé (config incohérente) → compté quand même en coût.
  if (D > 0.005) totalInterest += D;

  const crdAtDate = (isoDate: string) => {
    // CRD = capital après la dernière échéance dont la date <= isoDate (sinon capital initial).
    let v = C;
    for (const r of schedule) { if (r.date <= isoDate) v = r.crdAfter; else break; }
    return v;
  };
  const paidCountAtDate = (isoDate: string) => schedule.filter((r) => r.date <= isoDate).length;

  // Échéancier RÉEL : remboursement et assurance peuvent partir à des dates différentes, chacun sur la
  // durée TOTALE → on fusionne les deux flux par date. Si l'assurance est décalée, le tableau a plus de
  // lignes (certaines n'ont QUE l'assurance ; leur « restant dû » reprend celui du dernier remboursement).
  const insFirst = (p.first_insurance_date && /^\d{4}-\d{2}-\d{2}$/.test(p.first_insurance_date)) ? p.first_insurance_date : firstDate;
  let displaySchedule: AmortRow[];
  if (insFirst === firstDate) {
    displaySchedule = schedule; // mêmes dates → l'échéancier de remboursement porte déjà l'assurance
  } else {
    const byDate = new Map<string, AmortRow>();
    // 1) Remboursement (sans assurance sur ces lignes — l'assurance a sa propre date).
    for (const r of schedule) byDate.set(r.date, { ...r, insurance: 0 });
    // 2) Assurance à sa propre date (montant de la période correspondante).
    for (const r of schedule) {
      if (r.insurance <= 0) continue;
      const d = addMonthsISO(insFirst, r.period - 1);
      const ex = byDate.get(d);
      if (ex) ex.insurance += r.insurance;
      else byDate.set(d, { period: r.period, date: d, payment: 0, insurance: r.insurance, interest: 0, principalPart: 0, crdAfter: NaN });
    }
    displaySchedule = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    // 3) Restant dû des lignes assurance-seules = CRD du dernier remboursement antérieur.
    let lastCrd = C;
    for (const r of displaySchedule) { if (!Number.isNaN(r.crdAfter)) lastCrd = r.crdAfter; else r.crdAfter = lastCrd; }
  }

  return {
    monthlyPayment,
    monthlyWithInsurance: monthlyPayment + insForPeriod(Math.min(defN + 1, totalN)),
    totalInterest,
    totalInsurance,
    deferralInterest,
    totalCost: totalInterest + totalInsurance,
    schedule,
    displaySchedule,
    crdAtDate,
    paidCountAtDate,
  };
}
