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
 * Lecture DÉFENSIVE d'un nombre. Tous les paramètres de ce moteur viennent soit d'un champ de
 * saisie libre, soit de `profiles.projection_assumptions` — un JSON que l'utilisateur peut écrire
 * lui-même. Une valeur illisible (`NaN`, `Infinity`, `null`) se propageait jusqu'à l'écran, qui
 * affichait « NaN € » sans rien signaler.
 */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  const rate = num(p.annualRatePct) / 100;
  /* La fiscalité est bornée à [0 %, 100 %]. Le champ est libre et une faute de frappe courante
     (« 30 » qui devient « 300 ») produisait une taxe de 300 % : la plus-value nette passait en
     NÉGATIF et l'écran affichait « Plus-value nette : +-12 400 € ». Une part d'impôt ne peut ni
     être négative ni dépasser le gain. */
  const tax = Math.min(1, Math.max(0, num(p.taxRatePct) / 100));
  // Horizon borné : `years` vient d'un JSON de profil que l'utilisateur peut écrire lui-même.
  // Sans borne, une valeur aberrante fige l'écran dans une boucle de plusieurs millions de tours.
  const years = Math.max(0, Math.min(100, Math.floor(num(p.years))));
  const rows: InvestYearRow[] = [];

  let value = num(p.initialValue);
  let cumulativeContribution = p.initialContributed != null ? num(p.initialContributed) : value;

  /**
   * Valeur nette si on retirait tout : on ne paie l'impôt QUE sur une plus-value positive.
   *
   * L'ancienne formule (`capital versé + plus-value nette`) donnait le bon résultat tant que le
   * compte était en gain, mais mentait dès qu'il était en MOINS-VALUE : la plus-value nette étant
   * plafonnée à 0, elle renvoyait le capital versé — c'est-à-dire PLUS que la valeur réelle du
   * compte. La colonne « Net après taxe » affichait donc un montant supérieur à la colonne
   * « Valeur », comme si une perte se récupérait au retrait.
   */
  const afterTax = (v: number, gain: number) => v - Math.max(0, gain) * tax;

  // Ligne « année en cours » (N) : état réel actuel, hors hypothèse.
  const gainLatent0 = value - cumulativeContribution;
  let prevNetGainTotal = Math.max(0, gainLatent0) * (1 - tax);
  rows.push({
    year: startYear,
    contribution: 0,
    cumulativeContribution,
    value,
    gainLatent: gainLatent0,
    valueAfterTax: afterTax(value, gainLatent0),
    netGainTotal: prevNetGainTotal,
    netGainAnnual: 0,
    netGainMonthly: 0,
  });

  // Années projetées (N+1 … N+years) : l'hypothèse s'applique.
  for (let i = 1; i <= years; i++) {
    const year = startYear + i;
    // L'apport est versé en début d'année puis fructifie
    const contribution = num(p.annualContribution);
    value = (value + contribution) * (1 + rate);
    cumulativeContribution += contribution;

    const gainLatent = value - cumulativeContribution;
    const netGainTotal = Math.max(0, gainLatent) * (1 - tax);
    const valueAfterTax = afterTax(value, gainLatent);
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
  const monthlyRate = num(annualRatePct) / 100 / 12;
  const start = num(initial);
  const perMonth = num(monthly);
  return horizonsYears.map((y) => {
    // Horizon borné (cf. `projectInvestment`) : les valeurs viennent de l'écran, pas d'un constant.
    const years = Math.max(0, Math.min(100, Math.floor(num(y))));
    const months = years * 12;
    let value = start;
    for (let m = 0; m < months; m++) {
      value = value * (1 + monthlyRate) + perMonth;
    }
    const contributed = perMonth * months;
    return {
      years,
      label: years === 1 ? '1 an' : `${years} ans`,
      total: value,
      contributed,
      fromInitial: start * Math.pow(1 + monthlyRate, months),
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
 *
 * Compte UNIQUEMENT les virements sortants d'un compte courant vers un compte d'épargne. Les
 * apports directs posés sur un livret sont volontairement écartés (cf. `savingsContribution`) :
 * ce sont presque toujours des initialisations de solde, pas un effort d'épargne du mois.
 * (Le commentaire annonçait auparavant l'inverse de ce que le code fait — et l'écran répétait cette
 * promesse à l'utilisateur, qui cherchait donc un écart inexistant.)
 *
 * Règle : on lisse TOUJOURS sur 12 mois — la somme épargnée sur les 12 derniers mois ÷ 12.
 * (Ex. 5 000 € épargnés en 3 mois → 417 €/mois.) On démarre dès qu'il y a ≥ 1 mois de données.
 */
export function estimateMonthlySavings(transactions: SavedTx[], _accountCreatedAt?: string): number {
  const now = new Date();
  const flows = transactions
    .map((t) => ({ t, amount: savingsContribution(t) }))
    .filter((x) => x.amount > 0);
  if (flows.length === 0) return 0;

  /* ⚠️ Tout se compare EN CHAÎNES ISO, jamais en objets `Date`.
     `new Date('2026-08-01')` est parsé en UTC, alors que `new Date(y, m, 1)` est un minuit LOCAL :
     confronter les deux revenait à comparer deux repères décalés d'un fuseau. Dans les fuseaux à
     l'ouest de Greenwich, un versement daté du 1er du mois de coupure tombait juste en dessous et
     sortait de la fenêtre — l'épargne mensuelle estimée s'en trouvait rabotée. Les dates ISO
     s'ordonnent lexicographiquement : la comparaison de chaînes est exacte et sans fuseau. */

  // Au moins 1 mois de données : le 1er flux doit dater d'au moins le mois précédent OU
  // il faut au moins un flux dans le mois courant (on démarre l'estimation).
  const firstIso = flows.map((x) => String(x.t.date).slice(0, 10)).sort()[0];
  const [firstYear, firstMonth] = firstIso.split('-').map(Number);
  const monthsSinceFirst =
    (now.getFullYear() - firstYear) * 12 + (now.getMonth() - (firstMonth - 1)) + 1;
  if (monthsSinceFirst < 1) return 0;

  // Somme sur les 12 derniers mois, lissée sur 12. Borne = le 1er du mois, 11 mois en arrière.
  const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-01`;
  const windowTotal = flows
    .filter((x) => String(x.t.date).slice(0, 10) >= cutoff)
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
