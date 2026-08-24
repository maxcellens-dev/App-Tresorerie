import { readManualAllocation, resolveRecoMode, allocationTotal } from '../lib/finance/recoMode';
import { deriveRecoAllocations, computeRecommendations } from '../lib/finance/recommendationEngine';
import { resolveMonthlyAllocation } from '../lib/finance/financialPriorities';
import { PROFILE_ALLOCATIONS } from '../lib/finance/financialProfileEngine';

/**
 * MODE MANUEL DE RÉPARTITION.
 *
 * Deux promesses à tenir, et ce sont elles que ces tests gardent :
 *   1. les pourcentages choisis remplacent la table du palier — et RIEN d'autre ne change ;
 *   2. une répartition incomplète ou qui ne fait pas 100 % est ignorée : on retombe sur le profil,
 *      jamais sur des recommandations calculées avec une base à moitié écrite.
 */

/** Situation confortable : 6 mois de réserve, placements en cours → priorité « investir ». */
const comfortable: any = {
  safe_to_spend: 1000,
  safety_margin_amount: 0,
  current_savings: 12000,
  monthly_essential_expenses: 2000,
  /* Des charges RÉCURRENTES connues : sans elles, le matelas retombe sur le revenu (dénominateur
     prudent, cf. lib/securityCushion) et ces cas mesureraient autre chose que ce qu'ils annoncent. */
  has_recurring_expenses: true,
  avg_monthly_income: 3000,
  current_checking_balance: 3000,
  total_checking: 3000,
  total_savings: 12000,
  total_invested: 5000,
  safety_threshold_min: 5000,
  safety_threshold_optimal: 10000,
  safety_threshold_comfort: 20000,
  variable_trend_percentage: 100,
  committed_allocations: 0,
  remaining_fixed_expenses: 0,
};

/** Réserve quasi nulle : la priorité « te constituer un filet » borne l'investissement à 0 %. */
const noReserve: any = { ...comfortable, current_savings: 500, total_savings: 500, total_invested: 0 };

const manual = { save: 10, invest: 60, enjoy: 10, keep: 20 };

describe('readManualAllocation — ce qui est exploitable, et ce qui ne l’est pas', () => {
  it('accepte quatre valeurs qui totalisent 100', () => {
    expect(readManualAllocation({
      manual_alloc_save_percent: 10, manual_alloc_invest_percent: 60,
      manual_alloc_enjoy_percent: 10, manual_alloc_keep_percent: 20,
    })).toEqual(manual);
  });

  it('refuse une valeur manquante (une seule colonne vide suffit)', () => {
    expect(readManualAllocation({
      manual_alloc_save_percent: 10, manual_alloc_invest_percent: 60,
      manual_alloc_enjoy_percent: 10, manual_alloc_keep_percent: null,
    })).toBeNull();
  });

  it('refuse une somme différente de 100', () => {
    expect(readManualAllocation({
      manual_alloc_save_percent: 10, manual_alloc_invest_percent: 60,
      manual_alloc_enjoy_percent: 10, manual_alloc_keep_percent: 15,
    })).toBeNull();
  });
});

describe('resolveRecoMode — le mode réellement appliqué', () => {
  it('« manual » demandé + répartition valable → manuel', () => {
    const r = resolveRecoMode({
      reco_mode: 'manual',
      manual_alloc_save_percent: 10, manual_alloc_invest_percent: 60,
      manual_alloc_enjoy_percent: 10, manual_alloc_keep_percent: 20,
    });
    expect(r.mode).toBe('manual');
    expect(allocationTotal(r.manualAllocation!)).toBe(100);
  });

  it('« manual » demandé mais répartition inexploitable → retombe en automatique', () => {
    const r = resolveRecoMode({ reco_mode: 'manual', manual_alloc_save_percent: 10 });
    expect(r.mode).toBe('auto');
    expect(r.requested).toBe('manual');   // le réglage demandé reste lisible (l'écran le signale)
    expect(r.manualAllocation).toBeNull();
  });

  it('aucun réglage → automatique', () => {
    expect(resolveRecoMode(null).mode).toBe('auto');
    expect(resolveRecoMode({}).mode).toBe('auto');
  });
});

describe('deriveRecoAllocations — le manuel remplace la table du palier, et rien de plus', () => {
  it('sans mode manuel : la table du profil', () => {
    const { alloc } = deriveRecoAllocations(comfortable, { financialProfileId: 'P6' });
    // P6 = 12/40/25/23 ; aucune borne ne s'applique ici (plus de 6 mois de réserve).
    expect(alloc).toEqual(PROFILE_ALLOCATIONS.P6);
  });

  it('en manuel : les pourcentages choisis, appliqués tels quels', () => {
    const { alloc } = deriveRecoAllocations(comfortable, {
      financialProfileId: 'P6', manualAllocation: manual,
    });
    expect(alloc).toEqual(manual);
  });

  it('le PALIER de vocabulaire reste celui du profil réel', () => {
    const auto = deriveRecoAllocations(comfortable, { financialProfileId: 'P6' });
    const manuel = deriveRecoAllocations(comfortable, { financialProfileId: 'P6', manualAllocation: manual });
    expect(manuel.tier).toBe(auto.tier);
  });

  it('les BORNES de la priorité du mois s’appliquent aussi au manuel', () => {
    /* Moins d'un mois de réserve → priorité « te constituer un filet » : investissement borné à
       0 %, épargne plancher à 50 %. Demander 60 % d'investissement ne doit pas passer outre — c'est
       un réglage, pas un débrayage.
       On compare au MÊME calcul en automatique : les postes bornés doivent tomber au même endroit.
       Ce qui reste libre (Confort / Conserver) suit, lui, la répartition choisie — c'est justement
       l'influence qu'on a voulu lui laisser. */
    const manuel = deriveRecoAllocations(noReserve, {
      financialProfileId: 'P6', manualAllocation: manual,
    }).alloc;
    const auto = deriveRecoAllocations(noReserve, { financialProfileId: 'P6' }).alloc;

    expect(manuel.invest).toBe(auto.invest);          // 60 % demandés → ramenés au niveau borné
    expect(manuel.invest).toBeLessThan(manual.invest / 2);
    expect(manuel.save).toBe(auto.save);              // le plancher d'épargne remonte les 10 % demandés
    expect(manuel.save).toBeGreaterThan(manual.save);
    expect(manuel.save + manuel.invest + manuel.enjoy + manuel.keep).toBe(100);
  });

  it('la répartition manuelle ne s’applique QU’À LA BASE (bornes lues sans modificateurs)', () => {
    // `resolveMonthlyAllocation` est ce que les écrans affichent : profil + priorité, sans les
    // modificateurs contextuels. C'est là que la borne « investissement 0 % » se lit telle quelle.
    const situation = {
      monthsOfReserve: 0.25,
      monthlySurplus: 300,
      avgMonthlyIncome: 3000,
      monthlyEssentialExpenses: 2000,
      checkingBalance: 3000,
      savingsBalance: 500,
      investedBalance: 0,
    };
    const { alloc, priority } = resolveMonthlyAllocation('P6', situation, manual);
    expect(priority.id).toBe('emergency');
    expect(alloc.invest).toBe(0);
    expect(alloc.save).toBeGreaterThanOrEqual(50);
    expect(alloc.save + alloc.invest + alloc.enjoy + alloc.keep).toBe(100);
  });
});

describe('computeRecommendations — les montants suivent la répartition choisie', () => {
  const byType = (recos: any[]) => Object.fromEntries(recos.map((r) => [r.type, r]));

  it('budget réparti selon les pourcentages manuels', () => {
    const r = byType(computeRecommendations(comfortable, {
      financialProfileId: 'P6', manualAllocation: manual, budget: 1000,
    }));
    expect(r.invest.amount).toBe(600);
    expect(r.save.amount).toBe(100);
    expect(r.enjoy.amount).toBe(100);
    expect(r.keep.amount).toBe(200);
  });

  it('sans répartition manuelle, rien ne change par rapport à avant', () => {
    const before = computeRecommendations(comfortable, { financialProfileId: 'P6', budget: 1000 });
    const withNull = computeRecommendations(comfortable, {
      financialProfileId: 'P6', manualAllocation: null, budget: 1000,
    });
    expect(withNull.map((r) => [r.type, r.amount])).toEqual(before.map((r) => [r.type, r.amount]));
  });
});

describe('resolveMonthlyAllocation — même règle pour les écrans', () => {
  const situation = {
    monthsOfReserve: 6.5,
    monthlySurplus: 500,
    avgMonthlyIncome: 3000,
    monthlyEssentialExpenses: 2000,
    checkingBalance: 3000,
    savingsBalance: 12000,
    investedBalance: 5000,
  };

  it('sans base imposée : la table du palier', () => {
    expect(resolveMonthlyAllocation('P6', situation).alloc).toEqual(PROFILE_ALLOCATIONS.P6);
  });

  it('avec base imposée : la répartition choisie, bornée par la même priorité', () => {
    const { alloc, priority } = resolveMonthlyAllocation('P6', situation, manual);
    expect(alloc).toEqual(manual);
    // L'écran affiche cette priorité : elle doit être la même dans les deux modes.
    expect(priority.id).toBe(resolveMonthlyAllocation('P6', situation).priority.id);
  });
});
