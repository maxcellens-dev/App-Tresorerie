import { readManualAllocation, resolveRecoMode, allocationTotal, appliedAllocation } from '../lib/finance/recoMode';
import { deriveRecoAllocations, computeRecommendations } from '../lib/finance/recommendationEngine';
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

  /* ── PLUS AUCUN ÉTAGE NE RÉÉCRIT LA RÉPARTITION DE BASE ───────────────────────────────────────
     Un module `financialPriorities` classait la situation en sept priorités écrites en dur et
     imposait des bornes qui écrasaient les pourcentages du profil — y compris ceux réglés à la
     main. Quelqu'un qui posait 20 % d'épargne en voyait arriver 10, plus deux autres postes
     décalés par le report des points libérés : trois chiffres qu'il n'avait choisis nulle part.
     L'étage a été supprimé. Ce que ces bornes prétendaient protéger reste assuré plus bas, sur des
     MONTANTS réels (cascade, garde-fou projection, réconciliation Σ recos = Relyka). */
  it('la répartition de base n’est plus bornée, même sans réserve', () => {
    // Situation extrême (réserve quasi nulle) : c'est elle qui déclenchait « invest ≤ 0 %, save ≥ 50 ».
    const auto = deriveRecoAllocations(noReserve, { financialProfileId: 'P6' }).alloc;
    const manuel = deriveRecoAllocations(noReserve, {
      financialProfileId: 'P6', manualAllocation: manual,
    }).alloc;
    // L'investissement n'est plus ramené à zéro, ni l'épargne remontée à 50 %.
    expect(auto.invest).toBeGreaterThan(0);
    expect(auto.save).toBeLessThan(50);
    expect(manuel.invest).toBeGreaterThan(0);
    expect(manuel.save).toBeLessThan(50);
    expect(manuel.save + manuel.invest + manuel.enjoy + manuel.keep).toBe(100);
  });

  it('appliedAllocation dit la même chose que le moteur (écrans ⇄ recos)', () => {
    /* `appliedAllocation` est le point d'entrée des ÉCRANS. S'il répondait autre chose que le
       moteur, l'écran de réglage annoncerait une répartition et le tableau de bord en appliquerait
       une autre — c'est exactement ce que ce fichier existe pour empêcher. */
    expect(appliedAllocation('P6', manual)).toEqual(manual);
    expect(appliedAllocation('P6', null)).toEqual(PROFILE_ALLOCATIONS.P6);
    // Table de l'administration : elle prime sur celle du code, dans les deux sens de lecture.
    const admin = { ...PROFILE_ALLOCATIONS, P6: { save: 30, invest: 30, enjoy: 20, keep: 20 } };
    expect(appliedAllocation('P6', null, admin)).toEqual(admin.P6);
    expect(deriveRecoAllocations(comfortable, {
      financialProfileId: 'P6', profileAllocations: admin,
    }).alloc).toEqual(admin.P6);
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

describe('appliedAllocation — la répartition qui s’applique, sans condition', () => {
  it('sans réglage manuel : la table du palier', () => {
    expect(appliedAllocation('P6')).toEqual(PROFILE_ALLOCATIONS.P6);
    expect(appliedAllocation('P6', null)).toEqual(PROFILE_ALLOCATIONS.P6);
  });

  it('avec réglage manuel : la répartition choisie, telle quelle', () => {
    expect(appliedAllocation('P6', manual)).toEqual(manual);
  });

  it('rend une COPIE — un appelant ne peut pas abîmer la table du palier', () => {
    const a = appliedAllocation('P6');
    a.invest = 999;
    expect(PROFILE_ALLOCATIONS.P6.invest).not.toBe(999);
  });

  it('palier inconnu : repli sur P0 plutôt qu’une répartition vide', () => {
    expect(appliedAllocation('PX' as any)).toEqual(PROFILE_ALLOCATIONS.P0);
  });
});
