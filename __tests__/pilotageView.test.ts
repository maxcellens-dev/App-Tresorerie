/* On importe les calculs de VUE, jamais l'écran : `app/(tabs)/pilotage.tsx` tirerait react-native,
   qui ne s'exécute pas dans une suite Node. C'est exactement ce couplage que la phase C2 a rompu. */
import {
  monthReservationsTotal,
  computeRelykaBreakdown,
  buildRelykaBaseMessage,
  computeSuiviDetail,
  computeRecurUpcoming,
  computeSetupState,
  pickMainCheckingId,
  relykaTone,
} from '../lib/finance/pilotageView';
import type { PilotageData } from '../lib/finance/pilotageEngine';

/**
 * Tests de caractérisation des CALCULS DÉRIVÉS du tableau de bord (le Relyka tel qu'affiché, les
 * listes des modaux de suivi, l'état d'installation).
 *
 * Ils décrivent le comportement ACTUEL, celui qui tourne en production : leur rôle est de le FIGER,
 * pas de le juger. Jusqu'ici ces ~400 lignes vivaient au milieu du composant — un chiffre faux ne
 * pouvait se constater qu'à l'œil, sur l'écran, et un mois donné.
 *
 * L'horloge est injectée partout : les bascules de mois et de journée s'écrivent, au lieu de ne
 * devenir vérifiables qu'un jour par mois.
 */

/** Horloge de référence : 15 juin 2026, milieu de mois. */
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

/** Un `PilotageData` neutre : tout à zéro, pour que chaque test ne pose QUE ce qu'il éprouve. */
function pdata(over: Partial<PilotageData> = {}): PilotageData {
  return {
    safe_to_spend: 0, current_checking_balance: 0, remaining_fixed_expenses: 0,
    committed_allocations: 0, same_account_reserved: 0, monthly_commitments: 0,
    month_income_remaining: 0, cashflow_trough: 0, cashflow_trough_date: '',
    cashflow_horizon_end: '', next_income_date: null, next_income_amount: 0,
    expected_monthly_income: 0, avg_monthly_income: 0, expected_income_source: 'explicit',
    expected_income_confidence: 1, projection_min_buffer: 0, projection_in_danger: false,
    prudence: 0.5, monthly_savings_planned: 0, monthly_savings_remaining: 0,
    monthly_invest_planned: 0, monthly_invest_remaining: 0, month_savings_total: 0,
    month_savings_future: 0, month_invest_total: 0, month_invest_future: 0,
    real_savings_excl_projects: 0, real_invest: 0, monthly_reserve_planned: 0,
    month_expenses_total: 0, month_expenses_past: 0, month_expenses_remaining: 0,
    reserved_by_project: [], avg_variable_expenses_3m: 0, current_month_variable: 0,
    variable_trend_percentage: 0, variable_pace_percentage: null,
    variable_envelope_initial: 0, variable_envelope_spent: 0, variable_envelope_remaining: 0,
    variable_envelope_source: 'none', safety_margin_amount: 0,
    ...(over as any),
  } as PilotageData;
}

const noCumuls = { reservationsTotal: 0, preEpargneTotal: 0, preInvestTotal: 0 };

function account(over: Partial<any> = {}): any {
  return { id: uid('acc'), type: 'checking', balance: 1000, currency: 'EUR', ...over };
}

function tx(over: Partial<any> = {}): any {
  return {
    id: uid('tx'), account_id: 'acc-checking', amount: -50, date: iso(2026, 6, 10),
    is_recurring: false, recurrence_rule: null, is_draft: false, is_reserved: false,
    linked_account_id: null, project_id: null, note: null,
    category: { name: 'Courses', type: 'expense' },
    ...over,
  };
}

describe('monthReservationsTotal', () => {
  it("ne compte QUE les réservations du mois courant — celles d'un mois passé ne grèvent plus le Relyka", () => {
    const total = monthReservationsTotal([
      { created_at: iso(2026, 6, 2) + 'T10:00:00', montant: 100 },
      { created_at: iso(2026, 6, 14) + 'T10:00:00', montant: 50 },
      { created_at: iso(2026, 5, 28) + 'T10:00:00', montant: 999 }, // mois précédent
    ], NOW);
    expect(total).toBe(150);
  });

  it('accepte les montants en chaîne (Supabase renvoie du numeric en texte)', () => {
    expect(monthReservationsTotal([{ created_at: iso(2026, 6, 3), montant: '42.5' as any }], NOW)).toBe(42.5);
  });
});

describe('computeRelykaBreakdown — la soustraction à huit termes', () => {
  it('part du POINT BAS, pas du solde courant : un revenu pas encore reçu ne se dépense pas', () => {
    const b = computeRelykaBreakdown(
      pdata({ current_checking_balance: 2000, cashflow_trough: 300 }),
      noCumuls,
    );
    expect(b.cashflowTrough).toBe(300);
    expect(b.resteDisponible).toBe(300);
  });

  it('se replie sur le solde courant quand le moteur ne fournit pas de point bas', () => {
    const b = computeRelykaBreakdown({ ...pdata({ current_checking_balance: 800 }), cashflow_trough: undefined } as any, noCumuls);
    expect(b.cashflowTrough).toBe(800);
  });

  it('déduit les huit termes, puis arrondit à la dizaine INFÉRIEURE pour l\'affichage', () => {
    const b = computeRelykaBreakdown(pdata({
      cashflow_trough: 1000,
      month_savings_future: 100,
      month_invest_future: 50,
      monthly_reserve_planned: 30,
      variable_envelope_remaining: 200,
      safety_margin_amount: 60,
    }), { reservationsTotal: 40, preEpargneTotal: 10, preInvestTotal: 5 });
    // 1000 − 100 − 50 − 30 − 40 − 15 − 200 − 60 = 505
    expect(b.resteDisponibleBrut).toBe(505);
    expect(b.resteDisponible).toBe(505);
    expect(b.relykaAffiche).toBe(500);
  });

  it('ne déduit que la part FUTURE de l\'épargne : la part déjà virée est déjà dans le solde', () => {
    const b = computeRelykaBreakdown(pdata({
      cashflow_trough: 1000, month_savings_total: 400, month_savings_future: 100,
    }), noCumuls);
    expect(b.resteDisponible).toBe(900); // et non 600 : les 300 déjà virés ne sont pas recomptés
  });

  it('plafonne le Relyka à 0 mais garde la valeur BRUTE négative pour distinguer les causes', () => {
    const b = computeRelykaBreakdown(pdata({ cashflow_trough: -200 }), noCumuls);
    expect(b.resteDisponibleBrut).toBe(-200);
    expect(b.resteDisponible).toBe(0);
  });

  describe('« à 0 par choix » plutôt que « à sec »', () => {
    it('dit VOLONTAIRE quand tout le Relyka est parti en mises de côté', () => {
      const b = computeRelykaBreakdown(pdata({
        cashflow_trough: 500, month_savings_total: 500, month_savings_future: 500,
      }), noCumuls);
      expect(b.relykaAffiche).toBe(0);
      expect(b.misDeCoteTotal).toBe(500);
      expect(b.relykaAlloueVolontairement).toBe(true);
    });

    it("ne dit PAS volontaire à −1 000 € avec 100 € réservés : le manque dépasse la mise de côté", () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: -1000 }), {
        reservationsTotal: 100, preEpargneTotal: 0, preInvestTotal: 0,
      });
      expect(b.relykaAlloueVolontairement).toBe(false);
    });

    it('ne dit pas volontaire quand rien n\'a été mis de côté', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 0 }), noCumuls);
      expect(b.misDeCoteTotal).toBe(0);
      expect(b.relykaAlloueVolontairement).toBe(false);
    });
  });

  /* ── Couleur du chiffre principal ────────────────────────────────────────────────────────────
     Cette règle testait `relykaAffiche < 0`, une condition IMPOSSIBLE (`relykaAffiche` dérive d'un
     `Math.max(0, …)`) : le rouge n'a jamais pu s'afficher, et un compte réellement dans le rouge
     prenait la couleur d'une situation normale. Elle vivait en double, recopiée dans le view-model
     et dans l'écran. Ces cas la figent. */
  describe('relykaTone — la couleur du Relyka', () => {
    it('VERT dès qu\'il reste quelque chose à décider', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 500 }), noCumuls);
      expect(relykaTone(b)).toBe('positive');
    });

    it('BLEU quand le Relyka est à 0 parce que tout est rangé ailleurs', () => {
      const b = computeRelykaBreakdown(pdata({
        cashflow_trough: 500, month_savings_total: 500, month_savings_future: 500,
      }), noCumuls);
      expect(relykaTone(b)).toBe('allocated');
    });

    it('ROUGE quand le solde projeté est réellement négatif', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: -900 }), noCumuls);
      expect(b.relykaAffiche).toBe(0);          // le montant affiché ne descend jamais sous 0…
      expect(b.resteDisponibleBrut).toBeLessThan(0); // …mais le brut, lui, porte le signe
      expect(relykaTone(b)).toBe('negative');
    });

    it('ROUGE aussi quand ce qui est mis de côté ne suffit pas à revenir dans le vert', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: -1000 }), {
        reservationsTotal: 100, preEpargneTotal: 0, preInvestTotal: 0,
      });
      expect(relykaTone(b)).toBe('negative');
    });

    it('NEUTRE à 0 pile, sans rien mis de côté : il n\'y a ni manque ni choix', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 0 }), noCumuls);
      expect(relykaTone(b)).toBe('empty');
    });
  });

  describe('le point bas est une info À UNE DATE', () => {
    it('explique le point bas quand il est CONTRAIGNANT, et nomme la rentrée qui le suit', () => {
      const b = computeRelykaBreakdown(pdata({
        current_checking_balance: 2000,
        cashflow_trough: 300,
        cashflow_trough_date: iso(2026, 6, 24),
        next_income_date: iso(2026, 6, 25),
        next_income_amount: 1800,
      }), noCumuls);
      expect(b.troughLimits).toBe(true);
      expect(b.troughExplain).toContain('24 juin');
      expect(b.troughExplain).toContain('25 juin');
    });

    it('se tait quand le point bas ne creuse pas le compte (égal au solde d\'aujourd\'hui)', () => {
      const b = computeRelykaBreakdown(pdata({
        current_checking_balance: 1000, cashflow_trough: 1000, cashflow_trough_date: iso(2026, 6, 24),
      }), noCumuls);
      expect(b.troughLimits).toBe(false);
      expect(b.troughExplain).toBe('');
    });

    it('se tait quand le point bas tombe APRÈS la prochaine rentrée : il ne borne plus la période', () => {
      const b = computeRelykaBreakdown(pdata({
        current_checking_balance: 2000,
        cashflow_trough: 100,
        cashflow_trough_date: iso(2026, 7, 20),
        next_income_date: iso(2026, 6, 25),
        next_income_amount: 1800,
      }), noCumuls);
      expect(b.troughLimits).toBe(false);
    });

    it('n\'annonce pas de remontée quand aucune rentrée n\'est connue', () => {
      const b = computeRelykaBreakdown(pdata({
        current_checking_balance: 2000, cashflow_trough: 300, cashflow_trough_date: iso(2026, 6, 24),
      }), noCumuls);
      expect(b.troughLimits).toBe(true);
      expect(b.troughExplain).toContain('au plus bas');
      expect(b.troughExplain).not.toContain('remonter');
    });
  });

  it('signale un revenu DEVINÉ, et seulement lui', () => {
    expect(computeRelykaBreakdown(pdata({ expected_income_source: 'explicit' }), noCumuls).incomeIsGuessed).toBe(false);
    expect(computeRelykaBreakdown(pdata({ expected_income_source: 'inferred' }), noCumuls).incomeIsGuessed).toBe(true);
    expect(computeRelykaBreakdown(pdata({ expected_income_source: 'none' }), noCumuls).incomeIsGuessed).toBe(true);
  });

  it('rend un bilan entièrement à zéro sans données, sans lever', () => {
    const b = computeRelykaBreakdown(null, noCumuls);
    expect(b.relykaAffiche).toBe(0);
    expect(b.incomeIsGuessed).toBe(false); // pas de données ≠ revenu deviné
    expect(b.troughLimits).toBe(false);
  });

  /* ── « Tes réservations dépassent ton reste disponible » ────────────────────────────────────────
     L'alerte se comparait à `safe_to_spend`, l'ANCIEN modèle de budget : il ne déduit ni l'enveloppe
     variable, ni les virements prévus, ni les réservations, et vaut donc bien plus que le Relyka.
     Elle annonçait un dépassement « du reste disponible » en se mesurant à un tout autre montant que
     celui affiché juste au-dessus. La base, c'est le Relyka AVANT retrait des cumuls. */
  describe('dépassement des cumuls', () => {
    it('se déclenche quand les cumuls dépassent ce qui restait vraiment', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 100 }), { ...noCumuls, preEpargneTotal: 150 });
      expect(b.baseADepenser).toBe(100);      // ce que les cumuls avaient à disposition
      expect(b.resteDisponibleBrut).toBe(-50); // 50 € de trop mis de côté
      expect(b.enDepassement).toBe(true);
    });

    it('reste muet tant qu\'il y a de quoi couvrir les cumuls', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 400 }), { ...noCumuls, preEpargneTotal: 150 });
      expect(b.enDepassement).toBe(false);
    });

    it('ne juge rien sur un compte neuf, où il n\'y a pas encore de base à dépenser', () => {
      const b = computeRelykaBreakdown(pdata({ cashflow_trough: 0 }), { ...noCumuls, preEpargneTotal: 150 });
      expect(b.baseADepenser).toBe(0);
      expect(b.enDepassement).toBe(false);
    });

    it('ignore désormais `safe_to_spend`, l\'ancien modèle de budget', () => {
      const b = computeRelykaBreakdown(pdata({ safe_to_spend: 5000, cashflow_trough: 100 }), { ...noCumuls, preEpargneTotal: 150 });
      expect(b.enDepassement).toBe(true);
    });
  });
});

describe('buildRelykaBaseMessage', () => {
  const base = {
    relykaAffiche: 0, relykaAlloueVolontairement: false, misDeCoteTotal: 0,
    variableEnvelopeRemaining: 0, resteDisponibleBrut: 0,
  };

  /* Le message du budget dépassé testait `relykaAffiche < 0` — impossible, puisque le montant
     affiché dérive d'un `Math.max(0, …)`. Il n'a donc JAMAIS pu s'afficher : quelqu'un à −900 €
     lisait « tout ton argent est alloué », la phrase d'une situation normale, sous un chiffre rouge.
     C'est le brut qui porte le signe (même correction que pour la couleur). */
  it('annonce le budget dépassé quand le Relyka est réellement négatif', () => {
    const m = buildRelykaBaseMessage({ ...base, resteDisponibleBrut: -900, variableEnvelopeRemaining: 120 }, false);
    expect(m.text).toContain('Budget dépassé');
    expect(m.isGeneric).toBe(false);
  });

  it('préfère « tout est rangé ailleurs » quand les mises de côté expliquent le négatif', () => {
    const m = buildRelykaBaseMessage(
      { ...base, resteDisponibleBrut: -100, relykaAlloueVolontairement: true, misDeCoteTotal: 500 },
      false,
    );
    expect(m.text).toContain("Rien d'inquiétant");
  });

  it('salue la mise de côté au lieu d\'alerter quand le 0 est un CHOIX', () => {
    const m = buildRelykaBaseMessage({ ...base, relykaAlloueVolontairement: true, misDeCoteTotal: 500 }, false);
    expect(m.text).toContain("Rien d'inquiétant");
    expect(m.text).toContain('500');
    expect(m.isGeneric).toBe(false);
  });

  it('met en garde quand le 0 vient d\'un manque, pas d\'un choix', () => {
    expect(buildRelykaBaseMessage(base, false).text).toContain('Pas de marge');
  });

  it("distingue « épuisé mais tout est alloué » de « plus de marge du tout »", () => {
    expect(buildRelykaBaseMessage({ ...base, variableEnvelopeRemaining: 120 }, false).text).toContain('épuisé');
  });

  it('la phrase passe-partout du Relyka positif est marquée GÉNÉRIQUE (effaçable)', () => {
    const m = buildRelykaBaseMessage({ ...base, relykaAffiche: 500 }, false);
    expect(m.isGeneric).toBe(true);
    expect(m.text).toContain('librement');
  });

  it('invite à vérifier le solde quand le Relyka est donné en fourchette', () => {
    const m = buildRelykaBaseMessage({ ...base, relykaAffiche: 500 }, true);
    expect(m.text).toContain('vérifie ton solde');
    expect(m.isGeneric).toBe(true);
  });
});

describe('computeSuiviDetail — les listes des modaux du Suivi du mois', () => {
  const checking = account({ id: 'acc-checking', type: 'checking' });
  const savingsAcc = account({ id: 'acc-savings', type: 'savings' });
  const investAcc = account({ id: 'acc-invest', type: 'investment' });
  const accounts = [checking, savingsAcc, investAcc];

  it('classe les virements du mois en épargne et en investissement', () => {
    const d = computeSuiviDetail([
      tx({ amount: -200, linked_account_id: 'acc-savings', category: null }),
      tx({ amount: -300, linked_account_id: 'acc-invest', category: null }),
    ], accounts, NOW);
    expect(d.savings).toHaveLength(1);
    expect(d.invest).toHaveLength(1);
  });

  it('exclut les virements RÉSERVÉS (« conservé pour plus tard »)', () => {
    const d = computeSuiviDetail([
      tx({ amount: -200, linked_account_id: 'acc-savings', is_reserved: true, category: null }),
    ], accounts, NOW);
    expect(d.savings).toHaveLength(0);
  });

  it('compte une dépense passée du mois, mais pas une dépense à venir', () => {
    const d = computeSuiviDetail([
      tx({ amount: -50, date: iso(2026, 6, 10) }),  // passée
      tx({ amount: -70, date: iso(2026, 6, 28) }),  // à venir
      tx({ amount: -90, date: iso(2026, 5, 10) }),  // mois précédent
    ], accounts, NOW);
    expect(d.spent).toHaveLength(1);
    expect(d.spent[0].amount).toBe(-50);
  });

  it('inclut la dépense du JOUR MÊME (le 15, borne haute incluse)', () => {
    const d = computeSuiviDetail([tx({ amount: -50, date: iso(2026, 6, 15) })], accounts, NOW);
    expect(d.spent).toHaveLength(1);
  });

  it('garde un remboursement (montant positif sur une catégorie de dépense), exclut une recette', () => {
    const d = computeSuiviDetail([
      tx({ amount: 30, category: { name: 'Courses', type: 'expense' } }),
      tx({ amount: 2000, category: { name: 'Salaire', type: 'income' } }),
    ], accounts, NOW);
    expect(d.spent).toHaveLength(1);
    expect(d.spent[0].amount).toBe(30);
  });

  /* Une régul est de l'argent réellement en moins : elle compte comme dépensée, exactement comme
     dans « Tu as dépensé » (month_expenses_past). Un filtre sur le NOM de la catégorie les rejetait
     pourtant TOUTES depuis la migration 175, qui leur donne la sous-catégorie « Régularisation
     Solde » : le total du modal tombait alors sous le chiffre du tableau de bord. */
  it("garde une régul qui RÉDUIT le solde, catégorisée ou non, exclut celle qui l'augmente", () => {
    const d = computeSuiviDetail([
      tx({ amount: -80, category: null }),   // régul ancienne (sans catégorie) → dépensé
      tx({ amount: 120, category: null }),   // régul positive ancienne → pas une dépense
      tx({ amount: -60, category: { name: 'Régularisation Solde', type: 'expense' } }),  // depuis la 175
      tx({ amount: 90, category: { name: 'Régularisation Solde', type: 'income' } }),    // régul à la hausse
    ], accounts, NOW);
    expect(d.spent.map((t: any) => t.amount).sort((a: number, b: number) => a - b)).toEqual([-80, -60]);
  });

  it('exclut les brouillons et les virements du « Dépensé »', () => {
    const d = computeSuiviDetail([
      tx({ amount: -50, is_draft: true }),
      tx({ amount: -50, linked_account_id: 'acc-savings' }),
      // Projet « Mettre de côté » / « Conserver » : un brouillon, jamais une dépense.
      tx({ amount: -50, project_id: 'proj-1', is_draft: true }),
      tx({ amount: -50, project_id: 'proj-1', linked_account_id: 'acc-savings' }),
    ], accounts, NOW);
    expect(d.spent).toHaveLength(0);
  });

  /* Un projet « Dépenser petit à petit » produit de VRAIES dépenses, validées d'emblée : le moteur
     les compte dans « Tu as dépensé », le modal les ignorait — la somme des lignes ne retombait pas
     sur le chiffre du tableau de bord. */
  it('compte la dépense d\'un projet « Dépenser petit à petit »', () => {
    const d = computeSuiviDetail([tx({ amount: -50, project_id: 'proj-1' })], accounts, NOW);
    expect(d.spent).toHaveLength(1);
  });

  it('ne compte pas les dépenses faites depuis un compte NON courant', () => {
    const d = computeSuiviDetail([tx({ amount: -50, account_id: 'acc-savings' })], accounts, NOW);
    expect(d.spent).toHaveLength(0);
  });

  it('totalise les récurrentes ACTIVES ce mois et sépare la part déjà échue', () => {
    const d = computeSuiviDetail([
      tx({ id: 'loyer', amount: -800, date: iso(2026, 6, 5), is_recurring: true, recurrence_rule: 'monthly' }),
      tx({ id: 'assur', amount: -30, date: iso(2026, 6, 25), is_recurring: true, recurrence_rule: 'monthly' }),
    ], accounts, NOW);
    expect(d.recurringTotal).toBe(830);
    expect(d.recurringPassed).toBe(800); // seul le loyer du 5 est échu au 15
    expect(d.recurrentes).toHaveLength(2);
  });

  it("écarte une annuelle qui ne tombe pas dans le mois : le modal et le curseur affichent le même total", () => {
    const d = computeSuiviDetail([
      tx({ id: 'taxe', amount: -400, date: iso(2026, 9, 1), is_recurring: true, recurrence_rule: 'yearly' }),
    ], accounts, NOW);
    expect(d.recurringTotal).toBe(0);
    expect(d.recurrentes).toHaveLength(0);
  });

  it('trie les dépenses de la plus récente à la plus ancienne', () => {
    const d = computeSuiviDetail([
      tx({ amount: -10, date: iso(2026, 6, 3) }),
      tx({ amount: -20, date: iso(2026, 6, 12) }),
      tx({ amount: -30, date: iso(2026, 6, 7) }),
    ], accounts, NOW);
    expect(d.spent.map((t: any) => t.date)).toEqual([iso(2026, 6, 12), iso(2026, 6, 7), iso(2026, 6, 3)]);
  });

  it('ne renvoie que les comptes courants dans `checking`', () => {
    const d = computeSuiviDetail([], accounts, NOW);
    expect(d.checking.map((a: any) => a.id)).toEqual(['acc-checking']);
  });
});

describe('computeRecurUpcoming', () => {
  const rates = { EUR: 1, USD: 2 };
  const accounts = [account({ id: 'acc-checking', currency: 'EUR' })];

  it('ne retient que le RESTE à échoir de chaque récurrente', () => {
    const r = computeRecurUpcoming([
      { id: 'a', account_id: 'acc-checking', _monthTotal: 800, _monthPassed: 800 }, // soldée
      { id: 'b', account_id: 'acc-checking', _monthTotal: 100, _monthPassed: 40 },
    ], accounts, 'EUR', rates);
    expect(r.count).toBe(1);
    expect(r.amount).toBe(60);
    expect(r.list[0]._left).toBe(60);
  });

  it('convertit dans la devise de référence quand le compte est en devise étrangère', () => {
    const r = computeRecurUpcoming(
      [{ id: 'a', account_id: 'acc-usd', _monthTotal: 100, _monthPassed: 0 }],
      [account({ id: 'acc-usd', currency: 'USD' })],
      'EUR',
      rates,
    );
    expect(r.amount).toBe(50); // 100 USD au taux 2 → 50 EUR
  });

  it('rend zéro quand tout est déjà passé', () => {
    const r = computeRecurUpcoming([{ id: 'a', account_id: 'acc-checking', _monthTotal: 50, _monthPassed: 50 }], accounts, 'EUR', rates);
    expect(r).toEqual({ amount: 0, count: 0, list: [] });
  });
});

describe('computeSetupState — pourquoi le Relyka est à 0', () => {
  it('sans compte : invite à créer les comptes', () => {
    const s = computeSetupState([], [], 0);
    expect(s.noAccountsYet).toBe(true);
    expect(s.setupIncomplete).toBe(true);
    expect(s.setupHint).toContain('Crée tes comptes');
  });

  it('avec comptes mais sans récurrentes : invite à saisir les flux', () => {
    const s = computeSetupState([account()], [tx()], 0);
    expect(s.hasRecurringTx).toBe(false);
    expect(s.setupIncomplete).toBe(true);
    expect(s.setupHint).toContain('récurrentes');
  });

  it("une RÉGUL de solde ne compte pas comme une saisie de l'utilisateur", () => {
    const s = computeSetupState([account()], [tx({ note: 'Régularisation de solde' })], 0);
    expect(s.hasAnyTx).toBe(false);
  });

  /* La reconnaissance se faisait sur la NOTE. Or une régularisation saisie à la main peut n'avoir
     aucune note et n'être identifiée que par `regul_target` : elle passait alors pour une vraie
     opération, et l'accueil qui explique le Relyka à 0 disparaissait sans rien pour le remplacer. */
  it('reconnaît aussi une régul SANS note, identifiée par son seul marqueur', () => {
    const s = computeSetupState([account()], [tx({ note: null, regul_target: 1200 })], 0);
    expect(s.hasAnyTx).toBe(false);
  });

  it('une vraie opération compte, elle', () => {
    expect(computeSetupState([account()], [tx({ note: 'Boulangerie' })], 0).hasAnyTx).toBe(true);
    expect(computeSetupState([account()], [tx({ note: null })], 0).hasAnyTx).toBe(true);
  });

  it("un Relyka POSITIF ne déclenche jamais le message d'installation, même sans récurrente", () => {
    expect(computeSetupState([account()], [tx()], 500).setupIncomplete).toBe(false);
  });
});

describe('pickMainCheckingId', () => {
  /* C'est ce compte qui sert de SOURCE aux virements pré-remplis par les recommandations. Ne retenir
     que le solde le plus élevé faisait partir le virement d'un autre compte que le principal choisi
     par l'utilisateur (is_default, migration 146) — et, en multi-devises, convertissait le montant
     dans une devise qui n'était pas la sienne. */
  it('retient le compte PRINCIPAL de l\'utilisateur avant tout', () => {
    const id = pickMainCheckingId([
      account({ id: 'c1', type: 'checking', balance: 100, is_default: true }),
      account({ id: 'c2', type: 'checking', balance: 9000 }),
    ]);
    expect(id).toBe('c1');
  });

  it('retient le compte courant au solde le plus élevé', () => {
    const id = pickMainCheckingId([
      account({ id: 'c1', type: 'checking', balance: 100 }),
      account({ id: 'c2', type: 'checking', balance: 900 }),
      account({ id: 's1', type: 'savings', balance: 5000 }),
    ]);
    expect(id).toBe('c2');
  });

  it('ne modifie pas le tableau reçu (l\'ordre des comptes est fixé à la source)', () => {
    const accounts = [
      account({ id: 'c1', type: 'checking', balance: 100 }),
      account({ id: 'c2', type: 'checking', balance: 900 }),
    ];
    pickMainCheckingId(accounts);
    expect(accounts.map((a) => a.id)).toEqual(['c1', 'c2']);
  });

  it('rend undefined quand il n\'y a aucun compte courant', () => {
    expect(pickMainCheckingId([account({ type: 'savings' })])).toBeUndefined();
  });
});

/**
 * DONNÉES ABERRANTES — le chiffre principal de l'app ne doit jamais devenir illisible.
 *
 * `?? 0` ne couvre que `null` / `undefined` : un seul terme à `NaN` contaminait toute la
 * soustraction à huit termes, et la carte affichait « NaN € » — qu'aucun écran ne rattrapait
 * en aval. Ces cas figent la normalisation.
 */
describe('computeRelykaBreakdown — robustesse', () => {
  const noCumuls = { reservationsTotal: 0, preEpargneTotal: 0, preInvestTotal: 0 };

  it('un terme NaN ne contamine pas le Relyka', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: NaN, safety_margin_amount: 100 } as any, noCumuls);
    expect(Number.isFinite(b.relykaAffiche)).toBe(true);
    expect(Number.isFinite(b.resteDisponibleBrut)).toBe(true);
  });

  it('un cumul NaN ne contamine pas non plus', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: 1000 } as any, {
      reservationsTotal: NaN, preEpargneTotal: 0, preInvestTotal: NaN,
    });
    expect(b.relykaAffiche).toBe(1000);
  });

  it('une chaîne à la place d\'un nombre vaut 0, jamais NaN', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: 500, safety_margin_amount: 'oops' } as any, noCumuls);
    expect(b.safetyMarginDisplay).toBe(0);
    expect(b.relykaAffiche).toBe(500);
  });

  it('Infinity est traité comme une valeur absente', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: Infinity } as any, noCumuls);
    expect(Number.isFinite(b.relykaAffiche)).toBe(true);
  });

  it('aucune donnée du tout ne lève pas et rend un tableau de bord neutre', () => {
    const b = computeRelykaBreakdown(null, noCumuls);
    expect(b.relykaAffiche).toBe(0);
    expect(relykaTone(b)).toBe('empty');
  });

  it('un patrimoine très élevé reste fini', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: 1e12 } as any, noCumuls);
    expect(Number.isFinite(b.relykaAffiche)).toBe(true);
    expect(b.relykaAffiche).toBeGreaterThan(0);
  });
});

/**
 * RÉSERVATIONS : la frontière du mois se lit en heure LOCALE.
 *
 * `created_at` est un `timestamptz` rendu en UTC. Le découper à la main comparait un mois UTC à un
 * mois local : une réservation posée le 1ᵉʳ à 00 h 30 à Paris est stockée au 31 du mois précédent,
 * et disparaissait de tous les totaux. L'utilisateur mettait de l'argent de côté, le Relyka ne
 * bougeait pas, et rien ne l'expliquait.
 */
describe('monthReservationsTotal — frontière de mois', () => {
  it('compte une réservation posée juste après minuit le 1er du mois', () => {
    const nowSept = new Date(2026, 8, 15, 12, 0, 0);
    const createdAt = new Date(2026, 8, 1, 0, 30).toISOString(); // 31/08 en UTC si UTC+
    expect(monthReservationsTotal([{ created_at: createdAt, montant: 200 }], nowSept)).toBe(200);
  });

  it('exclut toujours une réservation du mois précédent', () => {
    const nowSept = new Date(2026, 8, 15, 12, 0, 0);
    const createdAt = new Date(2026, 7, 20, 12, 0).toISOString();
    expect(monthReservationsTotal([{ created_at: createdAt, montant: 999 }], nowSept)).toBe(0);
  });

  it('ignore une date illisible ou absente au lieu de la compter', () => {
    const now = new Date(2026, 8, 15);
    expect(monthReservationsTotal([
      { created_at: null, montant: 100 },
      { created_at: 'pas une date', montant: 100 },
    ], now)).toBe(0);
  });

  it('un montant illisible vaut 0, jamais NaN', () => {
    const now = new Date(2026, 8, 15);
    const createdAt = new Date(2026, 8, 10, 12, 0).toISOString();
    expect(monthReservationsTotal([{ created_at: createdAt, montant: 'oops' as any }], now)).toBe(0);
  });
});
