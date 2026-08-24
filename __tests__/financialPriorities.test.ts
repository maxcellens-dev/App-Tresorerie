import {
  computeFinancialPriority,
  applyPriorityBounds,
  resolveMonthlyAllocation,
  situationFromPilotage,
  normalize,
  type SituationInputs,
} from '../lib/finance/financialPriorities';
import { PROFILE_ALLOCATIONS } from '../lib/finance/financialProfileEngine';

/**
 * DEUX NIVEAUX : le profil pose le contexte, la SITUATION décide du mois.
 *
 * Avant, la répartition découlait mécaniquement du palier : « tu es P3, donc 45/5/15/35 », que le
 * mois finisse à découvert ou avec 800 € d'avance. Ces tests fixent la hiérarchie des priorités —
 * elles doivent DOMINER le profil, dans un ordre qui ne se discute pas.
 */
const base: SituationInputs = {
  monthsOfReserve: 4,
  monthlySurplus: 400,
  avgMonthlyIncome: 2500,
  monthlyEssentialExpenses: 1800,
  checkingBalance: 900,
  savingsBalance: 7200,
  investedBalance: 0,
};

describe('computeFinancialPriority — l’ordre des priorités', () => {
  it('dépenses > revenus → STABILISER, et rien d’autre ne compte', () => {
    const p = computeFinancialPriority({ ...base, monthlyEssentialExpenses: 2700, monthsOfReserve: 9 });
    expect(p.id).toBe('stabilize');
    expect(p.bounds.invest?.max).toBe(0);
  });


  /* La branche « dette coûteuse » a été RETIRÉE : aucun appelant n'a jamais renseigné le capital
     restant dû, et « coûteux » n'était défini nulle part. « Sortir du rouge » ne repose donc plus
     que sur le découvert chronique — qui, lui, est mesuré et transmis. */
  it('découvert chronique → SORTIR DU ROUGE, même avec une réserve confortable', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: 10, consecutiveOverdraftMonths: 3 });
    expect(p.id).toBe('debt');
    expect(p.bounds.invest?.max).toBe(0);
    expect(p.reason).toContain('3 mois');
  });

  it('moins d’1 mois de réserve → URGENCE, investissement à 0 %', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: 0.4 });
    expect(p.id).toBe('emergency');
    expect(p.bounds.invest?.max).toBe(0);
    expect(p.bounds.save?.min).toBe(50);
  });

  it('1 à 3 mois → CONSTRUIRE : investissement possible mais symbolique (≤ 5 %)', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: 2 });
    expect(p.id).toBe('build');
    expect(p.bounds.invest?.max).toBe(5);
  });

  /* La priorité « Financer ton projet » a été RETIRÉE : aucun appelant n'a jamais renseigné le
     besoin de financement, elle ne pouvait donc pas se déclencher. Une priorité qui ne se déclenche
     jamais n'est pas une règle. La réserve reste ce qui gouverne cette zone de l'échelle. */
  it('3 à 6 mois de réserve → ÉQUILIBRER, quoi qu’il y ait par ailleurs', () => {
    expect(computeFinancialPriority({ ...base, monthsOfReserve: 4 }).id).toBe('balanced');
  });

  it('3 à 6 mois → ÉQUILIBRER', () => {
    expect(computeFinancialPriority(base).id).toBe('balanced');
  });

  it('plus de 6 mois → INVESTIR : le liquide qui dort ne rapporte plus', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: 8, savingsBalance: 15000 });
    expect(p.id).toBe('invest');
    expect(p.bounds.save?.max).toBe(20);
  });

  it('réserve pleine ET patrimoine constitué ET déjà investi → OPTIMISER', () => {
    const p = computeFinancialPriority({
      ...base, monthsOfReserve: 9, savingsBalance: 40000, investedBalance: 90000,
    });
    expect(p.id).toBe('optimize');
  });

  /* Le patrimoine seul ne suffit pas : gros capital SANS placement, on reste à « investir ». */
  it('gros patrimoine mais rien de placé → on ne saute pas à OPTIMISER', () => {
    const p = computeFinancialPriority({
      ...base, monthsOfReserve: 9, savingsBalance: 150000, investedBalance: 0,
    });
    expect(p.id).toBe('invest');
  });

  it('réserve non mesurable → aucune priorité inventée', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: null });
    expect(p.bounds).toEqual({});
  });
});

describe('applyPriorityBounds — les bornes priment, le total reste à 100 %', () => {
  it('rabote l’investissement et redistribue sur les postes LIBRES', () => {
    const alloc = applyPriorityBounds(
      { ...PROFILE_ALLOCATIONS.P6 },                      // 12 / 40 / 25 / 23
      computeFinancialPriority({ ...base, monthsOfReserve: 0.5 }),  // urgence : invest 0, save ≥ 50
    );
    expect(alloc.invest).toBe(0);
    expect(alloc.save).toBeGreaterThanOrEqual(50);
    expect(alloc.save + alloc.invest + alloc.enjoy + alloc.keep).toBe(100);
  });

  /* Le point délicat : une renormalisation naïve ferait REPASSER un poste au-dessus de sa borne. */
  it('la renormalisation ne fait jamais repasser un poste au-delà de sa borne', () => {
    for (const id of ['P0', 'P1', 'P5', 'P7', 'P9'] as const) {
      const alloc = applyPriorityBounds(
        { ...PROFILE_ALLOCATIONS[id] },
        computeFinancialPriority({ ...base, monthsOfReserve: 0.2 }),
      );
      expect(`${id}:${alloc.invest}`).toBe(`${id}:0`);
      expect(alloc.save + alloc.invest + alloc.enjoy + alloc.keep).toBe(100);
    }
  });

  it('sans borne, la répartition du profil est intacte', () => {
    const p = computeFinancialPriority({ ...base, monthsOfReserve: null });
    expect(applyPriorityBounds({ ...PROFILE_ALLOCATIONS.P4 }, p)).toEqual(PROFILE_ALLOCATIONS.P4);
  });

  it('normalize ramène toujours à exactement 100 %', () => {
    expect(normalize({ save: 33, invest: 33, enjoy: 33, keep: 33 })).toEqual(
      expect.objectContaining({ save: 25, invest: 25, enjoy: 25 }),
    );
    const n = normalize({ save: 0, invest: 0, enjoy: 0, keep: 0 });
    expect(n.save + n.invest + n.enjoy + n.keep).toBe(100);
  });
});

/**
 * LE RÉSULTAT ATTENDU DU CHANGEMENT : à profil ÉGAL, deux situations différentes donnent deux
 * conseils différents. C'est précisément ce que l'ancien système ne savait pas faire.
 */
describe('resolveMonthlyAllocation — même profil, situations opposées', () => {
  it('deux P6 : l’un à découvert, l’autre à l’aise → deux répartitions différentes', () => {
    const aise = resolveMonthlyAllocation('P6', { ...base, monthsOfReserve: 8, investedBalance: 5000 });
    const rouge = resolveMonthlyAllocation('P6', { ...base, checkingBalance: -250, consecutiveOverdraftMonths: 2 });

    expect(aise.priority.id).toBe('invest');
    expect(rouge.priority.id).toBe('debt');
    expect(rouge.alloc.invest).toBe(0);
    expect(aise.alloc.invest).toBeGreaterThan(0);
    expect(aise.alloc).not.toEqual(rouge.alloc);
  });

  it('à situation égale, le PROFIL départage encore', () => {
    const situation = { ...base, monthsOfReserve: 4 };
    const p3 = resolveMonthlyAllocation('P3', situation);
    const p8 = resolveMonthlyAllocation('P8', situation);
    expect(p3.priority.id).toBe(p8.priority.id);          // même priorité…
    expect(p8.alloc.invest).toBeGreaterThan(p3.alloc.invest); // …mais pas la même décision
  });

  it('chaque répartition produite fait 100 %', () => {
    const situations: SituationInputs[] = [
      base,
      { ...base, monthsOfReserve: 0.3 },
      { ...base, monthsOfReserve: 2 },
      { ...base, monthsOfReserve: 12, investedBalance: 200000, savingsBalance: 50000 },
      { ...base, monthlyEssentialExpenses: 3000 },
      { ...base, checkingBalance: -100, consecutiveOverdraftMonths: 3 },
    ];
    for (const s of situations) {
      for (const id of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'] as const) {
        const { alloc } = resolveMonthlyAllocation(id, s);
        expect(alloc.save + alloc.invest + alloc.enjoy + alloc.keep).toBe(100);
      }
    }
  });
});

/* ── LA SITUATION DU MOIS, ASSEMBLÉE UNE SEULE FOIS ──────────────────────────────────────────────
   Elle était reconstruite à la main dans cinq fichiers, avec des champs différents d'un endroit à
   l'autre. Le plus coûteux des oublis : PERSONNE ne transmettait le découvert chronique, si bien
   que la priorité « Sortir du rouge » — la deuxième de la liste, documentée comme non négociable —
   ne s'est jamais déclenchée pour personne. L'app pouvait recommander d'investir 15 à 40 % à
   quelqu'un dont le compte finit dans le rouge tous les mois. */
describe('situationFromPilotage — le pont entre le tableau de bord et la priorité du mois', () => {
  const pilotage: any = {
    current_savings: 9000,
    total_invested: 2000,
    current_checking_balance: -250,
    avg_monthly_income: 3000,
    monthly_essential_expenses: 1500,
    has_recurring_expenses: true,
    consecutive_overdraft_months: 3,
    safe_to_spend: 400,
  };

  it('transmet le découvert chronique — et « Sortir du rouge » se déclenche enfin', () => {
    const s = situationFromPilotage(pilotage)!;
    expect(s.consecutiveOverdraftMonths).toBe(3);
    expect(computeFinancialPriority(s).id).toBe('debt');
  });

  it('sans découvert, la priorité redevient celle du matelas', () => {
    const s = situationFromPilotage({ ...pilotage, consecutive_overdraft_months: 0, current_checking_balance: 800 })!;
    expect(computeFinancialPriority(s).id).toBe('invest'); // 9 000 ÷ 1 500 = 6 mois
  });

  it('le matelas est mesuré avec la garde sur les charges connues', () => {
    // Sans charge récurrente saisie, le dénominateur « dépenses » est amputé du loyer : on retombe
    // sur le revenu (prudent), sinon la réserve gonfle et la priorité saute d'un cran.
    const sansCharges = situationFromPilotage({ ...pilotage, has_recurring_expenses: false })!;
    expect(sansCharges.monthsOfReserve).toBeCloseTo(9000 / 3000, 5);
    const avecCharges = situationFromPilotage(pilotage)!;
    expect(avecCharges.monthsOfReserve).toBeCloseTo(9000 / 1500, 5);
  });

  it('sans données de pilotage, aucune situation inventée', () => {
    expect(situationFromPilotage(null)).toBeNull();
  });

  it('des champs absents ne produisent pas de NaN', () => {
    const s = situationFromPilotage({} as any)!;
    for (const v of [s.monthlySurplus, s.avgMonthlyIncome, s.monthlyEssentialExpenses,
      s.checkingBalance, s.savingsBalance, s.investedBalance, s.consecutiveOverdraftMonths]) {
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(s.monthsOfReserve).toBeNull();
  });
});

/* Le seuil de viabilité est RÉGLABLE pour le classement du profil (`viability_enter_ratio`). Il
   était réécrit en dur ici (1,02) : déplacer le curseur faisait sortir quelqu'un du palier
   « Fragile » pendant que la priorité du mois continuait de lui répondre « rééquilibre ton mois ». */
describe('viabilité — un seul seuil pour une seule question', () => {
  const serré = {
    ...base, monthsOfReserve: 4, avgMonthlyIncome: 2000, monthlyEssentialExpenses: 2100,
  };

  it('au réglage par défaut, la situation est jugée déficitaire', () => {
    expect(computeFinancialPriority(serré).id).toBe('stabilize');
  });

  it('un seuil de viabilité plus large est respecté', () => {
    expect(computeFinancialPriority({ ...serré, viabilityEnterRatio: 1.2 }).id).not.toBe('stabilize');
  });
});
