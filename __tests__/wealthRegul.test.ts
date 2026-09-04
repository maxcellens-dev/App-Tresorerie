/**
 * MISE À JOUR DU SOLDE D'UN LIVRET / D'UN PLACEMENT (migration 223).
 *
 * Le geste ressemble à s'y méprendre à la régularisation d'un compte courant — même écran, même
 * champ, même ancre de solde — mais il ne raconte pas la même chose : « j'ai mis 500 € de côté sans
 * le noter », et non « il manque 80 € que je n'ai pas saisis ». Toute la valeur de la fonction tient
 * dans cette distinction, et elle est INVISIBLE à la relecture : les deux écritures se ressemblent
 * ligne à ligne en base. D'où ces cas, qui la verrouillent des deux côtés.
 *
 * Ce qui doit se produire (mouvement de patrimoine) :
 *   • elle compte dans l'épargne / l'investissement du mois (Pilotage, Reporting) ;
 *   • sur un compte d'investissement, elle vaut APPORT — jamais plus-value.
 * Ce qui ne doit PAS se produire (correction de trésorerie) :
 *   • aucune dépense ni recette du quotidien ;
 *   • aucune « vérification » des comptes courants (sinon le doute retombe à zéro pour un geste qui
 *     ne dit rien de ce qui a été dépensé).
 */
import { computePilotageData, type PilotageInput } from '../lib/finance/pilotageEngine';
import { buildSavingsSeries } from '../lib/finance/reportingEngine';
import { computeContributed } from '../lib/finance/contributed';
import { isRegul, isCashRegul, isWealthRegul, WEALTH_REGUL_KIND } from '../lib/finance/regul';

/** Horloge fixe : 15 juin 2026 (milieu de mois — passé et futur des deux côtés). */
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Mise à jour de solde d'épargne : une régul comme les autres, plus le marqueur. */
const wealth = (over: Partial<any> = {}): any => ({
  id: 'w1', profile_id: 'me', account_id: 'sav', amount: 500, date: iso(2026, 6, 10),
  is_draft: false, is_recurring: false, recurrence_rule: null, category_id: null,
  linked_account_id: null, note: 'Régularisation épargne',
  regul_target: 5500, regul_kind: WEALTH_REGUL_KIND, created_at: iso(2026, 6, 10),
  ...over,
});

describe('la définition — une régularisation, mais pas la même', () => {
  it('reste une régularisation (l’ancre de solde en dépend)', () => {
    expect(isRegul(wealth())).toBe(true);
  });
  it('n’est PAS une régularisation de trésorerie', () => {
    expect(isCashRegul(wealth())).toBe(false);
    expect(isWealthRegul(wealth())).toBe(true);
  });
  it('une régularisation de compte courant reste, elle, une régul de trésorerie', () => {
    const cash = { note: 'Régularisation solde', regul_target: 1200 };
    expect(isCashRegul(cash)).toBe(true);
    expect(isWealthRegul(cash)).toBe(false);
  });
});

// ── Pilotage ────────────────────────────────────────────────────────────────────────────────────

function input(over: Partial<PilotageInput> = {}): PilotageInput {
  return {
    profile: { id: 'me', currency_code: 'EUR', created_at: iso(2025, 1, 1) } as any,
    sharedFactor: {},
    sharedModeById: {},
    estimatedMonths: new Set<string>(),
    accounts: [
      { id: 'chk', profile_id: 'me', name: 'Courant', type: 'checking', balance: 2000, currency: 'EUR', is_joint: false, init_date: iso(2026, 1, 1), created_at: iso(2026, 1, 1) },
      { id: 'sav', profile_id: 'me', name: 'Livret', type: 'savings', balance: 5500, currency: 'EUR', is_joint: false, init_date: iso(2026, 1, 1), created_at: iso(2026, 1, 1) },
      { id: 'inv', profile_id: 'me', name: 'PEA', type: 'investment', balance: 3000, currency: 'EUR', is_joint: false, init_date: iso(2026, 1, 1), created_at: iso(2026, 1, 1) },
    ] as any,
    transactions: [],
    questionnaireAnswers: null,
    projects: [],
    monthOverrides: [],
    rates: { EUR: 1 },
    ...over,
  } as PilotageInput;
}
const run = (txs: any[]) => computePilotageData(input({ transactions: txs }), NOW);

describe('Pilotage — la mise à jour compte comme un virement', () => {
  it('une hausse sur un livret nourrit l’épargne du mois', () => {
    const r = run([wealth({ amount: 500 })]);
    expect(r.month_savings_total).toBe(500);
    // Datée d'aujourd'hui ou d'avant : déjà dans le solde, donc rien à redéduire du budget libre.
    expect(r.month_savings_future).toBe(0);
  });

  it('une baisse s’y compte en NÉGATIF (on a repris de l’argent)', () => {
    const r = run([wealth({ amount: -300, regul_target: 4700 })]);
    expect(r.month_savings_total).toBe(-300);
  });

  it('sur un placement, elle nourrit l’investissement du mois, pas l’épargne', () => {
    const r = run([wealth({ account_id: 'inv', amount: 800, regul_target: 3800 })]);
    expect(r.month_invest_total).toBe(800);
    expect(r.month_savings_total).toBe(0);
  });

  it('un mois PASSÉ ne pèse pas sur le mois en cours', () => {
    const r = run([wealth({ date: iso(2026, 4, 12) })]);
    expect(r.month_savings_total).toBe(0);
  });

  it('elle ne touche ni les dépenses ni l’enveloppe variable du mois', () => {
    const withIt = run([wealth({ amount: -300, regul_target: 4700 })]);
    const without = run([]);
    expect(withIt.variable_envelope_spent).toBe(without.variable_envelope_spent);
    expect(withIt.month_expenses_total).toBe(without.month_expenses_total);
  });

  it('elle ne vaut PAS vérification des comptes courants', () => {
    /* `last_verified_at` décide du doute affiché sur TOUS les montants de l'app. Relever son livret
       n'apprend rien sur ce qui a été dépensé au quotidien : la date ne doit pas avancer. */
    const withIt = run([wealth()]);
    const without = run([]);
    expect(withIt.confidence_inputs.lastVerifiedAt).toBe(without.confidence_inputs.lastVerifiedAt);
  });

  it('une régularisation de COMPTE COURANT, elle, vaut toujours vérification', () => {
    const cash = wealth({ id: 'c1', account_id: 'chk', regul_kind: null, note: 'Régularisation solde', amount: 40, regul_target: 2040 });
    expect(run([cash]).confidence_inputs.lastVerifiedAt).toBe(iso(2026, 6, 10));
  });
});

// ── Reporting ───────────────────────────────────────────────────────────────────────────────────

describe('Reporting — « mis de côté »', () => {
  const months = [{ ym: '2026-06', label: 'juin 2026' }];
  const typeById = { chk: 'checking', sav: 'savings', inv: 'investment' };

  it('compte la mise à jour d’un livret comme de l’épargne mise de côté', () => {
    const s = buildSavingsSeries([wealth()], months as any, typeById, { todayISO: iso(2026, 6, 15) });
    expect(s[0].savings).toBe(500);
    expect(s[0].saved).toBe(500);
  });

  it('la retranche quand le solde a BAISSÉ', () => {
    const s = buildSavingsSeries([wealth({ amount: -200 })], months as any, typeById, { todayISO: iso(2026, 6, 15) });
    expect(s[0].saved).toBe(-200);
  });

  it('sur un placement, elle compte en apport (donc hors performance)', () => {
    const s = buildSavingsSeries([wealth({ account_id: 'inv', amount: 800 })], months as any, typeById, { todayISO: iso(2026, 6, 15) });
    expect(s[0].invest).toBe(800);
  });
});

// ── Apport d'un compte d'investissement ─────────────────────────────────────────────────────────

describe('Apport — une mise à jour de placement est un versement, pas une plus-value', () => {
  const acc = { id: 'inv', type: 'investment', balance: 3800, initial_contributed: 3000 };

  it('une hausse augmente le capital investi', () => {
    const apport = computeContributed(acc, [wealth({ account_id: 'inv', amount: 800 })]);
    expect(apport).toBe(3800);
  });

  it('une plus-value, elle, ne l’augmente pas (rien n’a changé de ce côté)', () => {
    const gain = { account_id: 'inv', amount: 800, date: iso(2026, 6, 10), investment_kind: 'gain' };
    expect(computeContributed(acc, [gain as any])).toBe(3000);
  });

  it('une baisse retire du capital au prorata, comme un retrait', () => {
    // Valeur avant opération : 3 800 − (−800) … le compte vaut 3 800 après une reprise de 800 €.
    const a = { id: 'inv', type: 'investment', balance: 3800, initial_contributed: 4600 };
    const apport = computeContributed(a, [wealth({ account_id: 'inv', amount: -800, regul_target: 3800 })]);
    expect(apport).toBeLessThan(4600);
    expect(apport).toBeGreaterThan(0);
  });
});
