import { computeRecommendations, type RecoType } from '../lib/recommendationEngine';
import { isHidden } from '../lib/recoDismissals';
import { formatRangeLabel } from '../lib/currency';

/**
 * Cas « le montant affiché n'est pas le montant proposé ».
 * Situation d'origine : Relyka 154 € (revenu ~3 500 €) → le doute, mesuré sur le REVENU, dépasse le
 * Relyka → borne basse à 0 → la reco affichait « Conserver 150 € » mais l'action pré-remplissait 0 €
 * (« Réserver 0 € », description « Conserve au moins 0 € », confirmation sans effet).
 */

// Palier « below_optimal » : save 40 % / invest 10 % / enjoy 20 % / keep 30 %.
const base: any = {
  safe_to_spend: 1000,
  safety_margin_amount: 2000,
  projection_in_danger: false,
  current_savings: 8000,
  safety_threshold_min: 5000,
  safety_threshold_optimal: 10000,
  safety_threshold_comfort: 20000,
  variable_trend_percentage: 100,
  committed_allocations: 0,
  remaining_fixed_expenses: 0,
  current_checking_balance: 2600,
  total_checking: 2600,
  total_savings: 8000,
  total_invested: 5000,
  avg_monthly_income: 2500,
};

const byType = (recos: any[]) => Object.fromEntries(recos.map((r) => [r.type, r]));
/** Doute plus large que le budget : la borne basse proportionnelle tombe à 0 pour tous les postes. */
const doubtCrushesEverything = () => ({ value: 0, isRange: true });

describe('montant actionnable — filet anti-zéro', () => {
  it('borne basse écrasée à 0 → on retombe sur le montant proposé (jamais « au moins 0 € »)', () => {
    const r = byType(computeRecommendations(base, { actionAmountFor: doubtCrushesEverything }));
    expect(r.save.amount).toBe(400);
    expect(r.save.actionAmount).toBe(400);
    expect(r.save.description).not.toContain('au moins 0 €');
    expect(r.keep.actionAmount).toBeGreaterThan(0);
    expect(r.keep.description).not.toContain('au moins 0 €');
  });

  it('borne basse valable → elle est bien utilisée (« au moins … »)', () => {
    const r = byType(computeRecommendations(base, {
      actionAmountFor: (amount: number) => ({ value: Math.round(amount * 0.6), isRange: true }),
    }));
    expect(r.save.actionAmount).toBe(240);
    expect(r.save.description).toContain('au moins 240 €');
  });

  it('le type est transmis → « Conserver » peut être servi au montant plein (doute directionnel)', () => {
    const seen: RecoType[] = [];
    const r = byType(computeRecommendations(base, {
      actionAmountFor: (amount: number, type: RecoType) => {
        seen.push(type);
        return type === 'keep' ? { value: amount, isRange: false } : { value: Math.round(amount * 0.6), isRange: true };
      },
    }));
    expect(seen).toEqual(expect.arrayContaining(['save', 'invest', 'enjoy', 'keep']));
    expect(r.keep.actionAmount).toBe(r.keep.amount);
    expect(r.keep.description).toContain('300 €');
    expect(r.keep.description).not.toContain('au moins');
  });
});

describe('petit Relyka — repli « une seule reco »', () => {
  it('aucun poste n’atteint son seuil → on propose de TOUT conserver (au lieu de « tout est traité »)', () => {
    // 100 € répartis 40/10/20/30 % = 40/10/20/30 € : tous sous leurs seuils (50/100/50/50).
    // Avant, les 4 postes étaient filtrés un à un → « Toutes les recommandations ont été traitées ✨ »
    // alors qu'il restait 100 € non alloués.
    const recos = computeRecommendations(base, { budget: 100, maxAmount: 100 });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(100);
    expect(recos[0].actionAmount).toBe(100);
  });

  it('cas réel : épargne/invest déjà fléchés, il ne reste qu’une miette → tout conserver', () => {
    // Relyka 154 € : la part épargne (62 €) et invest (15 €) sont déjà engagées ce mois.
    const recos = computeRecommendations(base, {
      budget: 154,
      maxAmount: 150,
      alreadyAllocated: { save: 62, invest: 15 },
    });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(70); // 31 (confort) + 46 (conserver) − arrondi
    expect(recos[0].actionAmount).toBe(70);
  });

  it('un seul poste passe son seuil → il absorbe tout le reste', () => {
    // 154 € : seule l'épargne (62 € ≥ 50) atteint son seuil → elle récupère les miettes.
    const recos = computeRecommendations(base, { budget: 154, maxAmount: 150 });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('save');
    expect(recos[0].amount).toBe(150);
  });

  it('reste dérisoire → aucune reco', () => {
    expect(computeRecommendations(base, { budget: 6, maxAmount: 0 })).toEqual([]);
  });
});

describe('miettes & arrondis — Σ(recos) = Relyka', () => {
  it('les postes sous leur seuil sont versés au poste le mieux protégé', () => {
    // Budget 300 → save 120 / invest 30 / enjoy 60 / keep 90. invest (30 < 100) est une miette.
    // Ordre « équilibré » : enjoy, invest, keep, save → le mieux protégé est « save ».
    const recos = computeRecommendations(base, { budget: 300 });
    const r = byType(recos);
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(150); // 120 + 30
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(300);
  });

  it('le reliquat d’arrondi à la dizaine n’est pas perdu', () => {
    // Budget 1007 → 402,8 / 100,7 / 201,4 / 302,1 → arrondis 400/100/200/300 = 1000 (7 € perdus),
    // alors que le Relyka affiché vaut 1000 → le reliquat rejoint le poste le mieux protégé.
    const recos = computeRecommendations(base, { budget: 1007, maxAmount: 1000 });
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(1000);
  });

  it('Σ(recos) ne dépasse JAMAIS le Relyka affiché (plafond appliqué à la somme)', () => {
    // Le plafond `maxAmount` s'applique poste par poste : sans réconciliation, 400+100+200+300 = 1000
    // s'affichait au-dessus d'un Relyka annoncé à 990.
    const recos = computeRecommendations(base, { budget: 999, maxAmount: 990 });
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(990);
  });
});

describe('freins de sécurité — plus de carte « 0 € », plus de double compte', () => {
  it('Relyka déjà à 0 → aucune reco (au lieu d’un « Conserver 0 € »)', () => {
    const recos = computeRecommendations({ ...base, projection_in_danger: true }, {
      budget: 1000, maxAmount: 0,
    });
    expect(recos).toEqual([]);
  });

  it('ce qui est déjà alloué n’est pas reproposé', () => {
    const recos = computeRecommendations({ ...base, projection_in_danger: true }, {
      budget: 1000,
      alreadyAllocated: { save: 300, keep: 200 },
    });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(500);
  });

  it('tout est déjà alloué → aucune reco', () => {
    const recos = computeRecommendations({ ...base, projection_in_danger: true }, {
      budget: 1000,
      alreadyAllocated: { save: 1000 },
    });
    expect(recos).toEqual([]);
  });
});

describe('fin de mois', () => {
  it('le « Confort » bascule vers « Conserver » sur les derniers jours', () => {
    const mid = byType(computeRecommendations(base, { daysLeftInMonth: 20 }));
    const end = byType(computeRecommendations(base, { daysLeftInMonth: 0 }));
    expect(mid.enjoy.amount).toBe(200);
    expect(end.enjoy).toBeUndefined();          // 0 % → filtré, son montant part en réserve
    expect(end.keep.amount).toBe(500);          // 300 + 200
    // Épargner / investir ne bougent pas (capacité d'investissement du Pouls inchangée).
    expect(end.save.amount).toBe(mid.save.amount);
    expect(end.invest.amount).toBe(mid.invest.amount);
  });

  it('bascule PROGRESSIVE (pas d’effet falaise au 7ᵉ jour avant la fin)', () => {
    const j7 = byType(computeRecommendations(base, { daysLeftInMonth: 7 }));
    const j3 = byType(computeRecommendations(base, { daysLeftInMonth: 3 }));
    expect(j7.enjoy.amount).toBe(200);
    expect(j3.enjoy.amount).toBeGreaterThan(0);
    expect(j3.enjoy.amount).toBeLessThan(200);
  });

  // Vocabulaire figé : le geste s'appelle « Réserver » partout à l'affichage (comme la ligne
  // « Réservé » du suivi). Seul l'horizon change en fin de mois.
  it('en fin de mois, le titre bascule sur le mois prochain', () => {
    const end = byType(computeRecommendations(base, { daysLeftInMonth: 2 }));
    expect(end.keep.title).toBe('Réserver pour le mois prochain');
    expect(end.keep.shortTitle).toBe('Réserver');
    expect(end.keep.description).toContain('mois prochain');
  });

  it('hors fin de mois, les libellés ne changent pas', () => {
    const mid = byType(computeRecommendations(base, { daysLeftInMonth: 15 }));
    expect(mid.keep.title).toBe('Réserver pour plus tard');
    expect(mid.keep.shortTitle).toBe('Réserver');
  });
});

describe('« Ignorer » — tolérance de réapparition', () => {
  it('un montant qui bouge de quelques euros ne fait pas revenir la reco', () => {
    const ignored = { save: 400 };
    expect(isHidden('save', 400, ignored, [])).toBe(true);
    expect(isHidden('save', 412, ignored, [])).toBe(true);   // ±10 %
    expect(isHidden('save', 500, ignored, [])).toBe(false);  // vrai changement de situation
  });

  it('petits montants : tolérance plancher de 20 €', () => {
    expect(isHidden('keep', 65, { keep: 50 }, [])).toBe(true);   // ±20 € minimum
    expect(isHidden('keep', 80, { keep: 50 }, [])).toBe(false);
  });
});

describe('libellé de fourchette', () => {
  it('borne basse nulle → « jusqu’à X » (pas « 0–X »)', () => {
    expect(formatRangeLabel(0, 260)).toBe('jusqu\'à 260 €');
    expect(formatRangeLabel(0, 260, { symbol: false, compact: true })).toBe('≤ 260');
  });
  it('fourchette normale et bornes confondues', () => {
    expect(formatRangeLabel(120, 264)).toBe('120–260 €');
    expect(formatRangeLabel(121, 129)).toBe('120 €');
  });
});
