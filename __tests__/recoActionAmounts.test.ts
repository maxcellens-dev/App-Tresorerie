import { computeRecommendations, type RecoType } from '../lib/finance/recommendationEngine';
import { isHidden } from '../lib/finance/recoDismissals';
import { formatRangeLabel } from '../lib/finance/currency';

/**
 * Cas « le montant affiché n'est pas le montant proposé ».
 * Situation d'origine : Relyka 154 € (revenu ~3 500 €) → le doute, mesuré sur le REVENU, dépasse le
 * Relyka → borne basse à 0 → la reco affichait « Conserver 150 € » mais l'action pré-remplissait 0 €
 * (« Réserver 0 € », description « Conserve au moins 0 € », confirmation sans effet).
 */

/**
 * RÉPARTITION EXPLICITE — 40 / 10 / 20 / 30.
 *
 * Ces cas portent sur la MÉCANIQUE du moteur (miettes, cascade, arrondis, garde-fou), pas sur les
 * pourcentages : ils ont besoin d'une répartition stable, pas de celle d'un palier précis.
 *
 * Elle était jusqu'ici obtenue en NE PASSANT PAS de profil, ce qui faisait retomber le moteur sur
 * une échelle déduite du montant d'épargne. Cette échelle a été retirée : elle était inatteignable
 * en production (`buildRecoOptions` passe toujours un identifiant) et ces tests étaient donc son
 * seul utilisateur — on validait des pourcentages que personne ne recevait. On les pose maintenant
 * à la main, ce qui dit exactement ce que les cas supposent.
 */
const ALLOC = { save: 40, invest: 10, enjoy: 20, keep: 30 };
const reco = (data: any, opts: any = {}) =>
  computeRecommendations(data, { manualAllocation: ALLOC, ...opts });

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
    const r = byType(reco(base, { actionAmountFor: doubtCrushesEverything }));
    expect(r.save.amount).toBe(400);
    expect(r.save.actionAmount).toBe(400);
    expect(r.save.description).not.toContain('au moins 0 €');
    expect(r.keep.actionAmount).toBeGreaterThan(0);
    expect(r.keep.description).not.toContain('au moins 0 €');
  });

  it('borne basse valable → elle est bien utilisée (« au moins … »)', () => {
    const r = byType(reco(base, {
      actionAmountFor: (amount: number) => ({ value: Math.round(amount * 0.6), isRange: true }),
    }));
    expect(r.save.actionAmount).toBe(240);
    expect(r.save.description).toContain('au moins 240 €');
  });

  /* `amountPhrase` préfixe « au moins », mais « Confort » enchâsse le montant dans un groupe
     nominal : la phrase unique donnait « Fais ce que tu veux des au moins 240 € restants », qui ne
     se lit pas. C'est le seul texte de reco dans ce cas. */
  it('« Confort » reste lisible en fourchette (pas de « des au moins … restants »)', () => {
    const enFourchette = byType(reco(base, {
      actionAmountFor: (amount: number) => ({ value: Math.round(amount * 0.6), isRange: true }),
    }));
    expect(enFourchette.enjoy.description).not.toContain('des au moins');
    expect(enFourchette.enjoy.description).toContain("d'au moins 120 €");

    const sansFourchette = byType(reco(base));
    expect(sansFourchette.enjoy.description).toContain('des 200 € restants');
  });

  it('le type est transmis → « Conserver » peut être servi au montant plein (doute directionnel)', () => {
    const seen: RecoType[] = [];
    const r = byType(reco(base, {
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
    const recos = reco(base, { budget: 100, maxAmount: 100 });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(100);
    expect(recos[0].actionAmount).toBe(100);
  });

  it('cas réel : épargne/invest déjà fléchés, il ne reste qu’une miette → tout conserver', () => {
    // Relyka 154 € : la part épargne (62 €) et invest (15 €) sont déjà engagées ce mois.
    const recos = reco(base, {
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
    const recos = reco(base, { budget: 154, maxAmount: 150 });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('save');
    expect(recos[0].amount).toBe(150);
  });

  it('reste dérisoire → aucune reco', () => {
    expect(reco(base, { budget: 6, maxAmount: 0 })).toEqual([]);
  });
});

describe('miettes & arrondis — Σ(recos) = Relyka', () => {
  it('les postes sous leur seuil sont versés au poste le mieux protégé', () => {
    // Budget 300 → save 120 / invest 30 / enjoy 60 / keep 90. invest (30 < 100) est une miette.
    // Ordre « équilibré » : enjoy, invest, keep, save → le mieux protégé est « save ».
    const recos = reco(base, { budget: 300 });
    const r = byType(recos);
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(150); // 120 + 30
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(300);
  });

  it('le reliquat d’arrondi à la dizaine n’est pas perdu', () => {
    // Budget 1007 → 402,8 / 100,7 / 201,4 / 302,1 → arrondis 400/100/200/300 = 1000 (7 € perdus),
    // alors que le Relyka affiché vaut 1000 → le reliquat rejoint le poste le mieux protégé.
    const recos = reco(base, { budget: 1007, maxAmount: 1000 });
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(1000);
  });

  it('Σ(recos) ne dépasse JAMAIS le Relyka affiché (plafond appliqué à la somme)', () => {
    // Le plafond `maxAmount` s'applique poste par poste : sans réconciliation, 400+100+200+300 = 1000
    // s'affichait au-dessus d'un Relyka annoncé à 990.
    const recos = reco(base, { budget: 999, maxAmount: 990 });
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

describe('fin de période (avant la prochaine rentrée d’argent)', () => {
  /* Les MONTANTS ne bougent plus avec les jours restants : la bascule progressive « Confort →
     Conserver » faisait partie des modificateurs contextuels, retirés. Ce sont les pourcentages du
     profil qui s'appliquent, du premier au dernier jour de la période. Seuls les LIBELLÉS changent
     à l'approche de la rentrée d'argent (tests suivants). */
  it('les montants sont les MÊMES du premier au dernier jour de la période', () => {
    const mid = byType(reco(base, { daysLeftInPeriod: 20 }));
    for (const daysLeftInPeriod of [7, 3, 0]) {
      const jour = byType(reco(base, { daysLeftInPeriod }));
      expect(jour.enjoy.amount).toBe(mid.enjoy.amount);
      expect(jour.keep.amount).toBe(mid.keep.amount);
      expect(jour.save.amount).toBe(mid.save.amount);
      expect(jour.invest.amount).toBe(mid.invest.amount);
    }
    expect(mid.enjoy.amount).toBe(200);
  });

  // Vocabulaire figé : le geste s'appelle « Réserver » partout à l'affichage (comme la ligne
  // « Réservé » du suivi). Seul l'horizon change à l'approche de la rentrée d'argent.
  it('à l’approche de la rentrée d’argent, le titre bascule sur la suite', () => {
    const end = byType(reco(base, { daysLeftInPeriod: 2 }));
    expect(end.keep.title).toBe('Réserver pour après ta rentrée d’argent');
    expect(end.keep.shortTitle).toBe('Réserver');
    expect(end.keep.description).toContain('rentrée d\'argent');
  });

  it('en pleine période, les libellés ne changent pas', () => {
    const mid = byType(reco(base, { daysLeftInPeriod: 15 }));
    expect(mid.keep.title).toBe('Réserver pour plus tard');
    expect(mid.keep.shortTitle).toBe('Réserver');
  });

  /* LE BUG CORRIGÉ : payé le 25, l'utilisateur perdait son « Confort » du 25 au 31 — le calendrier
     décrétait « fin de mois » alors qu'il venait d'être payé. Période inconnue ou lointaine = rien
     ne bouge ; seule la vraie rentrée d'argent déclenche la bascule. */
  it('sans période connue, « Confort » reste INTACT (plus de fonte calendaire)', () => {
    const mid = byType(reco(base, { daysLeftInPeriod: 20 }));
    const inconnu = byType(reco(base, {}));
    const nul = byType(reco(base, { daysLeftInPeriod: null }));
    expect(inconnu.enjoy.amount).toBe(mid.enjoy.amount);
    expect(nul.enjoy.amount).toBe(mid.enjoy.amount);
    expect(inconnu.keep.title).toBe('Réserver pour plus tard');
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

/* ── LA TRACE DES ÉCARTS ────────────────────────────────────────────────────────────────────────
   Les pourcentages appliqués sont désormais EXACTEMENT ceux du profil (les priorités du mois et les
   modificateurs contextuels ont été retirés). Mais les MONTANTS peuvent encore s'en écarter pour
   des raisons factuelles, et l'utilisateur n'avait aucun moyen de savoir lesquelles. Le moteur
   consigne donc ce qu'il fait, au moment où il le fait — c'est ce que l'écran de réglage affiche.

   Deux exigences : ne RIEN signaler quand le calcul est nominal, et ne signaler QUE ce qui a
   réellement eu lieu (une exception inventée serait pire que pas d'explication du tout). */
describe('trace des écarts — ce que le moteur a réellement fait', () => {
  const traceOf = (data: any, opts: any = {}) => {
    const trace: any[] = [];
    computeRecommendations(data, { ...opts, trace });
    return trace;
  };

  it('calcul nominal → AUCUN écart signalé', () => {
    expect(traceOf(base)).toEqual([]);
  });

  it('argent déjà mis de côté ce mois-ci', () => {
    expect(traceOf(base, { alreadyAllocated: { save: 150 } })).toContain('already_allocated');
  });

  it('budget variable dépassé → cascade', () => {
    expect(traceOf(base, { overspend: 200 })).toContain('cascade');
  });

  it('un dépassement NUL ne déclenche pas la cascade', () => {
    expect(traceOf(base, { overspend: 0 })).not.toContain('cascade');
  });

  it('solde courant sous la marge de sécurité', () => {
    expect(traceOf({ ...base, total_checking: 500 })).toEqual(['margin_freeze']);
  });

  it('trajectoire en danger', () => {
    expect(traceOf({ ...base, projection_in_danger: true })).toEqual(['projection_freeze']);
  });

  it('point bas de projection sous la marge → gel, et non un simple plafond', () => {
    const t = traceOf(base, { projectionGuard: { margin: 1000, balances: [800, 900, 1200] } });
    expect(t).toEqual(['projection_freeze']);
  });

  it('épargne + invest plafonnés par le point bas → l’excédent part en « Conserver »', () => {
    // Point bas 1 400 au-dessus de la marge 1 000 → headroom 400, alors que save+invest valent 500.
    const t = traceOf(base, { projectionGuard: { margin: 1000, balances: [1400, 1600, 1800] } });
    expect(t).toContain('projection_guard');
  });

  it('reste trop petit pour être découpé → une seule reco', () => {
    expect(traceOf({ ...base, safe_to_spend: 60 })).toContain('single_fallback');
  });

  it('sans collecteur, le moteur rend exactement le même résultat', () => {
    const avec: any[] = [];
    const a = reco(base, { overspend: 200, trace: avec });
    const b = reco(base, { overspend: 200 });
    expect(a.map((r) => [r.type, r.amount])).toEqual(b.map((r) => [r.type, r.amount]));
    expect(avec.length).toBeGreaterThan(0);
  });
});
