import {
  projectInvestment, projectSavings, sumProjections, investCurve, estimateMonthlySavings,
} from '../lib/finance/projectionEngine';

/**
 * Moteur de la page Projection (onglets Investissement et Épargne).
 *
 * Ce qui est vérifié ici est ce que l'utilisateur LIT à l'écran : des colonnes qui doivent rester
 * cohérentes entre elles (valeur / capital versé / net après impôt) quelles que soient les
 * hypothèses saisies — y compris les aberrantes, puisque les champs sont libres.
 */

const base = {
  initialValue: 10000,
  initialContributed: 8000,   // 2 000 € de plus-value latente
  annualContribution: 1200,
  annualRatePct: 7,
  years: 3,
  taxRatePct: 30,
  startYear: 2026,
};

describe('projectInvestment — cohérence des colonnes', () => {
  const rows = projectInvestment(base);

  it('la 1ʳᵉ ligne est l’année en cours, au RÉEL (aucun apport, aucune croissance)', () => {
    expect(rows[0]).toMatchObject({ year: 2026, contribution: 0, value: 10000, cumulativeContribution: 8000 });
    expect(rows).toHaveLength(4); // année en cours + 3 années projetées
  });

  it('intérêts composés : valeur = (valeur + apport) × (1 + taux)', () => {
    expect(rows[1].value).toBeCloseTo((10000 + 1200) * 1.07, 6);
    expect(rows[2].value).toBeCloseTo(((10000 + 1200) * 1.07 + 1200) * 1.07, 6);
    expect(rows[3].cumulativeContribution).toBe(8000 + 3 * 1200);
  });

  it('plus-value latente = valeur − capital versé, sur chaque ligne', () => {
    for (const r of rows) expect(r.gainLatent).toBeCloseTo(r.value - r.cumulativeContribution, 6);
  });

  it('net après impôt = valeur − impôt sur la plus-value, et jamais plus que la valeur', () => {
    for (const r of rows) {
      expect(r.valueAfterTax).toBeCloseTo(r.value - Math.max(0, r.gainLatent) * 0.3, 6);
      expect(r.valueAfterTax).toBeLessThanOrEqual(r.value + 1e-9);
    }
  });

  it('gain net mensuel = gain net annuel ÷ 12', () => {
    for (const r of rows) expect(r.netGainMonthly).toBeCloseTo(r.netGainAnnual / 12, 9);
  });
});

describe('projectInvestment — compte en MOINS-VALUE', () => {
  /* RÉGRESSION : `valueAfterTax` valait « capital versé + plus-value nette ». La plus-value nette
     étant plancherisée à 0, un compte en perte affichait un « Net après taxe » ÉGAL AU CAPITAL
     VERSÉ — donc supérieur à sa propre valeur, comme si la perte se récupérait au retrait. */
  const perte = projectInvestment({ ...base, initialValue: 6000, initialContributed: 9000, years: 0 });

  it('le net après impôt vaut la valeur réelle (une perte ne se taxe pas, et ne se rembourse pas)', () => {
    expect(perte[0].gainLatent).toBe(-3000);
    expect(perte[0].valueAfterTax).toBe(6000);
    expect(perte[0].valueAfterTax).toBeLessThanOrEqual(perte[0].value);
  });

  it('aucune plus-value nette à annoncer tant que le compte est en perte', () => {
    expect(perte[0].netGainTotal).toBe(0);
  });
});

describe('projectInvestment — hypothèses aberrantes (champs libres)', () => {
  it('fiscalité > 100 % (faute de frappe « 300 ») : bornée, la plus-value nette ne passe pas en négatif', () => {
    const r = projectInvestment({ ...base, taxRatePct: 300, years: 1 });
    for (const row of r) {
      expect(row.netGainTotal).toBeGreaterThanOrEqual(0);
      expect(row.valueAfterTax).toBeGreaterThanOrEqual(row.cumulativeContribution - row.gainLatent - 1e-9);
      expect(row.valueAfterTax).toBeLessThanOrEqual(row.value + 1e-9);
    }
  });

  it('fiscalité négative : bornée à 0 (pas de « bonus » d’impôt)', () => {
    const r = projectInvestment({ ...base, taxRatePct: -50, years: 1 });
    expect(r[0].valueAfterTax).toBe(r[0].value);
  });

  it('horizon aberrant (JSON de profil modifié) : borné, l’écran ne se fige pas', () => {
    const r = projectInvestment({ ...base, years: 1e9 });
    expect(r).toHaveLength(101); // année en cours + 100 années projetées
  });

  it('valeurs illisibles : 0 par défaut, jamais NaN', () => {
    const r = projectInvestment({ ...base, initialValue: NaN as any, annualContribution: undefined as any, years: 2 });
    for (const row of r) {
      expect(Number.isFinite(row.value)).toBe(true);
      expect(Number.isFinite(row.valueAfterTax)).toBe(true);
    }
  });

  it('horizon 0 : une seule ligne, l’année en cours', () => {
    expect(projectInvestment({ ...base, years: 0 })).toHaveLength(1);
  });
});

describe('sumProjections — total multi-comptes', () => {
  it('somme ligne à ligne, en gardant l’année', () => {
    const a = projectInvestment({ ...base, years: 2 });
    const b = projectInvestment({ ...base, initialValue: 5000, initialContributed: 5000, years: 2 });
    const t = sumProjections([a, b]);
    expect(t).toHaveLength(3);
    for (let i = 0; i < t.length; i++) {
      expect(t[i].year).toBe(a[i].year);
      expect(t[i].value).toBeCloseTo(a[i].value + b[i].value, 6);
      expect(t[i].cumulativeContribution).toBeCloseTo(a[i].cumulativeContribution + b[i].cumulativeContribution, 6);
    }
  });

  it('aucun compte → aucune ligne (et non une ligne de zéros)', () => {
    expect(sumProjections([])).toEqual([]);
  });

  it('la courbe reprend valeur et capital versé de chaque année', () => {
    const c = investCurve(projectInvestment({ ...base, years: 1 }));
    expect(c).toEqual([
      { label: '2026', value: 10000, contributed: 8000 },
      { label: '2027', value: (10000 + 1200) * 1.07, contributed: 9200 },
    ]);
  });
});

describe('projectSavings — horizons d’épargne', () => {
  it('sans rendement : total = capital de départ + versements', () => {
    const [h] = projectSavings(1000, 100, [1], 0);
    expect(h.total).toBe(1000 + 1200);
    expect(h.contributed).toBe(1200);
  });

  it('avec rendement : le total dépasse « départ + versements » (et « Épargné » reste hors intérêts)', () => {
    const [h] = projectSavings(1000, 100, [10], 2);
    expect(h.contributed).toBe(12000);
    expect(h.total).toBeGreaterThan(1000 + 12000);
  });

  it('rien épargné : le capital de départ fructifie seul', () => {
    const [h] = projectSavings(5000, 0, [1], 2);
    expect(h.contributed).toBe(0);
    expect(h.total).toBeCloseTo(5000 * Math.pow(1 + 0.02 / 12, 12), 6);
    expect(h.fromInitial).toBeCloseTo(h.total, 6);
  });

  it('tout à zéro : total 0, pas de NaN', () => {
    const [h] = projectSavings(0, 0, [5], 2);
    expect(h.total).toBe(0);
  });
});

describe('estimateMonthlySavings — rythme réel', () => {
  const now = new Date();
  const iso = (monthsAgo: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`;
  };
  const vers = (monthsAgo: number, amount: number, note?: string) => ({
    amount: -Math.abs(amount), date: iso(monthsAgo),
    account_type: 'checking', linked_account_type: 'savings', note: note ?? 'Virement épargne',
  });

  it('lisse TOUJOURS sur 12 mois (3 000 € en 3 mois → 250 €/mois)', () => {
    expect(estimateMonthlySavings([vers(0, 1000), vers(1, 1000), vers(2, 1000)])).toBe(250);
  });

  it('ignore les versements plus vieux que la fenêtre de 12 mois', () => {
    expect(estimateMonthlySavings([vers(0, 1200), vers(20, 100000)])).toBe(100);
  });

  it('ignore les transactions d’initialisation de compte', () => {
    expect(estimateMonthlySavings([vers(0, 1200, 'Solde initial')])).toBe(0);
  });

  it('aucun virement vers l’épargne → 0 (et non une division par zéro)', () => {
    expect(estimateMonthlySavings([])).toBe(0);
    expect(estimateMonthlySavings([{ amount: -50, date: iso(0), account_type: 'checking', linked_account_type: null }])).toBe(0);
  });
});
