/**
 * Moteur de projection financière.
 * - Investissements : intérêts composés sur N années avec apports réguliers + fiscalité.
 * - Épargne : valeur future selon un rythme d'épargne mensuel.
 */

export interface InvestYearRow {
  year: number;
  contribution: number;          // apport de l'année
  cumulativeContribution: number; // apports cumulés (capital investi)
  value: number;                 // valeur du portefeuille fin d'année
  gainLatent: number;            // plus-value latente (value - cumulativeContribution)
  valueAfterTax: number;         // valeur si on retire (capital + plus-value nette de taxe)
  netGainTotal: number;          // plus-value nette de taxe cumulée
  netGainAnnual: number;         // plus-value nette générée cette année
  netGainMonthly: number;        // équivalent mensuel
}

export interface InvestProjectionParams {
  initialValue: number;       // valeur actuelle du portefeuille
  initialContributed?: number; // capital réellement versé jusqu'ici (base non taxable). Défaut = initialValue
  annualContribution: number; // apport ajouté chaque année
  annualRatePct: number;      // rendement annuel moyen (%)
  years: number;              // horizon (nombre d'années)
  taxRatePct: number;         // fiscalité sur la plus-value (%)
  startYear?: number;         // année de départ (défaut : année courante)
}

/**
 * Projette un portefeuille d'investissement année par année.
 * Modèle : valeur_début = valeur_fin_précédente + apport ; valeur_fin = valeur_début × (1 + taux).
 * La fiscalité ne s'applique qu'à la plus-value (valeur − capital versé).
 * `initialContributed` permet de distinguer la valeur actuelle (avec plus-value latente)
 * du capital réellement versé (base non taxable).
 *
 * La 1ʳᵉ ligne (année en cours) reflète le RÉEL : valeur actuelle, sans apport ni
 * croissance de l'hypothèse. L'hypothèse (apports + rendement) ne s'applique qu'à
 * partir de l'année suivante (N+1) ; `years` = nombre d'années projetées après N.
 */
export function projectInvestment(p: InvestProjectionParams): InvestYearRow[] {
  const startYear = p.startYear ?? new Date().getFullYear();
  const rate = p.annualRatePct / 100;
  const tax = p.taxRatePct / 100;
  const rows: InvestYearRow[] = [];

  let value = p.initialValue;
  let cumulativeContribution = p.initialContributed ?? p.initialValue;

  // Ligne « année en cours » (N) : état réel actuel, hors hypothèse.
  const gainLatent0 = value - cumulativeContribution;
  let prevNetGainTotal = Math.max(0, gainLatent0) * (1 - tax);
  rows.push({
    year: startYear,
    contribution: 0,
    cumulativeContribution,
    value,
    gainLatent: gainLatent0,
    valueAfterTax: cumulativeContribution + prevNetGainTotal,
    netGainTotal: prevNetGainTotal,
    netGainAnnual: 0,
    netGainMonthly: 0,
  });

  // Années projetées (N+1 … N+years) : l'hypothèse s'applique.
  for (let i = 1; i <= p.years; i++) {
    const year = startYear + i;
    // L'apport est versé en début d'année puis fructifie
    const contribution = p.annualContribution;
    value = (value + contribution) * (1 + rate);
    cumulativeContribution += contribution;

    const gainLatent = value - cumulativeContribution;
    const netGainTotal = Math.max(0, gainLatent) * (1 - tax);
    const valueAfterTax = cumulativeContribution + netGainTotal;
    const netGainAnnual = netGainTotal - prevNetGainTotal;
    prevNetGainTotal = netGainTotal;

    rows.push({
      year,
      contribution,
      cumulativeContribution,
      value,
      gainLatent,
      valueAfterTax,
      netGainTotal,
      netGainAnnual,
      netGainMonthly: netGainAnnual / 12,
    });
  }
  return rows;
}

export interface SavingsHorizon {
  years: number;
  label: string;
  total: number;        // capital total à l'horizon
  contributed: number;  // montant épargné cumulé
  fromInitial: number;  // part provenant du capital de départ
}

/**
 * Projette l'épargne (sans rendement, ou avec un petit taux livret optionnel).
 * @param initial capital épargne actuel
 * @param monthly montant épargné chaque mois
 * @param horizonsYears liste d'horizons en années
 * @param annualRatePct rendement annuel de l'épargne (livrets ~2-3 %), défaut 0
 */
export function projectSavings(
  initial: number,
  monthly: number,
  horizonsYears: number[],
  annualRatePct = 0,
): SavingsHorizon[] {
  const monthlyRate = annualRatePct / 100 / 12;
  return horizonsYears.map((years) => {
    const months = years * 12;
    let value = initial;
    for (let m = 0; m < months; m++) {
      value = value * (1 + monthlyRate) + monthly;
    }
    const contributed = monthly * months;
    return {
      years,
      label: years === 1 ? '1 an' : `${years} ans`,
      total: value,
      contributed,
      fromInitial: initial * Math.pow(1 + monthlyRate, months),
    };
  });
}

/** Somme plusieurs projections (multi-comptes) année par année en une projection globale. */
export function sumProjections(list: InvestYearRow[][]): InvestYearRow[] {
  if (list.length === 0) return [];
  const years = Math.max(...list.map((r) => r.length));
  const out: InvestYearRow[] = [];
  for (let i = 0; i < years; i++) {
    let agg: InvestYearRow | null = null;
    for (const rows of list) {
      const r = rows[i];
      if (!r) continue;
      if (!agg) {
        agg = { ...r };
      } else {
        agg = {
          year: r.year,
          contribution: agg.contribution + r.contribution,
          cumulativeContribution: agg.cumulativeContribution + r.cumulativeContribution,
          value: agg.value + r.value,
          gainLatent: agg.gainLatent + r.gainLatent,
          valueAfterTax: agg.valueAfterTax + r.valueAfterTax,
          netGainTotal: agg.netGainTotal + r.netGainTotal,
          netGainAnnual: agg.netGainAnnual + r.netGainAnnual,
          netGainMonthly: agg.netGainMonthly + r.netGainMonthly,
        };
      }
    }
    if (agg) out.push(agg);
  }
  return out;
}

/** Génère les points (année → valeur) pour tracer une courbe d'investissement. */
export function investCurve(rows: InvestYearRow[]): { label: string; value: number; contributed: number }[] {
  return rows.map((r) => ({
    label: String(r.year),
    value: r.value,
    contributed: r.cumulativeContribution,
  }));
}

// ── Estimation du rythme d'épargne réel ───────────────────────

export interface SavedTx {
  amount: number;
  date: string;
  account_type: string;
  linked_account_type?: string | null;
  note?: string | null;
}

/** Une transaction d'ouverture de compte (à exclure du flux d'épargne). */
function isInitialisation(note?: string | null): boolean {
  return !!note && /initialisation|initialis|solde initial|ouverture/i.test(note);
}

/** Montant épargné apporté par une transaction (0 si non pertinent). */
function savingsContribution(t: SavedTx): number {
  if (isInitialisation(t.note)) return 0;
  // Virement sortant du courant vers un compte d'épargne
  if (t.amount < 0 && t.account_type === 'checking' && t.linked_account_type === 'savings') {
    return Math.abs(t.amount);
  }
  // NOTE: Do NOT count direct deposits on savings accounts (t.amount > 0 && account_type === 'savings')
  // as these are typically account setup transfers or fund initializations, not actual savings contributions.
  return 0;
}

/**
 * Estime l'épargne mensuelle moyenne réelle.
 * Compte les virements vers l'épargne ET les apports directs sur les comptes d'épargne,
 * en excluant les transactions d'initialisation (solde d'ouverture).
 * Règle : on lisse TOUJOURS sur 12 mois — la somme épargnée sur les 12 derniers mois ÷ 12.
 * (Ex. 5 000 € épargnés en 3 mois → 417 €/mois.) On démarre dès qu'il y a ≥ 1 mois de données.
 */
export function estimateMonthlySavings(transactions: SavedTx[], _accountCreatedAt?: string): number {
  const now = new Date();
  const flows = transactions
    .map((t) => ({ t, amount: savingsContribution(t) }))
    .filter((x) => x.amount > 0);
  if (flows.length === 0) return 0;

  // Au moins 1 mois de données : le 1er flux doit dater d'au moins le mois précédent OU
  // il faut au moins un flux dans le mois courant (on démarre l'estimation).
  const firstDate = new Date(Math.min(...flows.map((x) => new Date(x.t.date).getTime())));
  const monthsSinceFirst =
    (now.getFullYear() - firstDate.getFullYear()) * 12 + (now.getMonth() - firstDate.getMonth()) + 1;
  if (monthsSinceFirst < 1) return 0;

  // Somme sur les 12 derniers mois, lissée sur 12.
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const windowTotal = flows
    .filter((x) => new Date(x.t.date) >= cutoff)
    .reduce((s, x) => s + x.amount, 0);

  return windowTotal / 12;
}

// ── Estimation depuis le questionnaire ────────────────────────

/** Revenu net mensuel moyen estimé depuis la réponse Q3. */
export function incomeFromQ3(q3?: string): number {
  switch (q3) {
    case 'Moins de 1 500 €': return 1200;
    case 'De 1 500 € à 2 500 €': return 2000;
    case 'De 2 500 € à 4 000 €': return 3250;
    case 'Plus de 4 000 €': return 5000;
    default: return 0;
  }
}

/** Taux d'épargne mensuel (fraction) estimé depuis la réponse Q6. */
export function savingsRateFromQ6(q6?: string): number {
  switch (q6) {
    case '0 %': return 0;
    case 'Moins de 10 %': return 0.05;
    case 'Entre 10 % et 20 %': return 0.15;
    case 'Entre 20 % et 30 %': return 0.25;
    case 'Plus de 30 %': return 0.35;
    case "Je n'ai plus besoin d'augmenter mon épargne actuellement": return 0.1;
    default: return 0;
  }
}
