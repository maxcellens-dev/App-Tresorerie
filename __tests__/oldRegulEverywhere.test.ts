/**
 * UNE régularisation ANCIENNE doit être vue partout comme une régularisation.
 *
 * Une régul écrite avant que la colonne `regul_target` existe n'a pas de solde cible : elle ne se
 * reconnaît qu'à sa note. Plusieurs calculs testaient pourtant `regul_target == null`, un critère
 * plus étroit que la définition canonique (`isRegul`) — un écart de solde ancien devenait alors une
 * vraie recette ici et rien du tout là, et deux écrans annonçaient deux chiffres pour le même mois.
 *
 * Ces cas verrouillent la cohérence des trois chemins qui avaient divergé : le plan de trésorerie,
 * l'instantané envoyé aux Conseils IA, et la détection des changements à venir.
 */
import { isRegul } from '../lib/finance/regul';
import { computeMonthlyForecast } from '../lib/finance/forecast';
import { detectUpcomingChanges, type UpcomingTx } from '../lib/ai/aiUpcoming';

interface RegulShape { note: string | null; regul_target: number | null }
/** Régul ANCIENNE : une note, aucun `regul_target`. */
const oldRegul: RegulShape = { note: 'Régularisation solde', regul_target: null };
/** Régul RÉCENTE : un solde cible, et parfois aucune note. */
const newRegul: RegulShape = { note: null, regul_target: 1500 };

describe('la définition d’une régularisation est la même partout', () => {
  it('reconnaît les deux formes', () => {
    expect(isRegul(oldRegul)).toBe(true);
    expect(isRegul(newRegul)).toBe(true);
    expect(isRegul({ note: 'Courses', regul_target: null })).toBe(false);
  });

  /* Les DEUX formes, dans CHAQUE chemin. Ne tester que celle qui était déjà attrapée ferait passer
     le test sans rien prouver : le plan de trésorerie reconnaissait la note et ratait le solde
     cible, l'instantané IA faisait exactement l'inverse. */
  const forms: [string, RegulShape][] = [
    ['ancienne (note seule)', oldRegul],
    ['récente (solde cible, sans note)', newRegul],
  ];

  it.each(forms)('plan de trésorerie : une régul %s n’est pas comptée comme un revenu', (_l, regul) => {
    const accounts = [{ id: 'a1', type: 'checking', balance: 1000 }];
    const base = {
      id: 't', account_id: 'a1', is_draft: false, is_recurring: false,
      recurrence_rule: null, category_id: null, linked_account_id: null,
    };
    const now = new Date(2026, 6, 10); // 10 juillet 2026
    const common = { accounts, variableMonthly: 0, variableRemaining: 0, monthsCount: 1, now };

    const withRegul = computeMonthlyForecast({
      ...common,
      transactions: [{ ...base, ...regul, date: '2026-07-05', amount: 900 }],
    } as any);
    const without = computeMonthlyForecast({ ...common, transactions: [] } as any);

    // La régularisation ne gonfle pas les revenus du mois : les deux prévisions coïncident.
    expect(withRegul[0].income).toBe(without[0].income);
  });

  it.each(forms)('Conseils IA : une régul %s n’est ni un engagement à venir, ni une nouveauté', (_l, regul) => {
    const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const txs: UpcomingTx[] = [
      { id: 'r', date: future, amount: -400, accountType: 'checking', ...regul },
    ];
    const res = detectUpcomingChanges(txs, {
      today: new Date().toISOString().slice(0, 10),
      acctTypeById: {},
      fullCat: () => 'Sans catégorie',
      isRefund: () => false,
    });
    expect(res.starts).toHaveLength(0);
    expect(res.endings).toHaveLength(0);
    expect(res.oneOffs).toHaveLength(0);
  });
});
