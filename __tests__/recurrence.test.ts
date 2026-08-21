import { addRecurrenceToMonth, recurrencePastInMonth, recurrenceOccurrencesBetween, monthlyOccurrenceCount, monthlyOccurrenceDates } from '../lib/finance/recurrence';
import type { RecurrenceRule } from '../types/database';

/**
 * Preuve d'équivalence avant regroupement.
 *
 * `addRecurrenceToMonth` existait en deux exemplaires : le moteur du Pilotage et
 * `app/(tabs)/tresorerie.tsx`. Avant de n'en garder qu'un, il fallait établir qu'ils répondaient
 * bien la même chose — sinon le regroupement aurait silencieusement changé les montants d'un des
 * deux écrans.
 *
 * `legacyTresorerie` ci-dessous est la version Trésorerie recopiée MOT POUR MOT (elle ne peut pas
 * être importée : elle vivait dans un fichier `.tsx` qui tire react-native). Elle sert d'ORACLE, et
 * reste dans ce fichier après le regroupement : c'est elle qui garantit que la version partagée
 * n'a pas dérivé.
 */
function legacyTresorerie(
  year: number, month: number, amount: number, startDate: string,
  rule: RecurrenceRule, endDate: string | null, currentDate: Date,
): number {
  const start = new Date(startDate);
  // Limite à 24 mois maximum à partir de maintenant
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  if (start > thisMonthEnd || end < thisMonthStart) return 0;
  if (rule === 'monthly') return amount;
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth) return amount;
    return 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() === month - 1 && year >= start.getFullYear()) return amount;
    return 0;
  }
  if (rule === 'weekly') {
    let count = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) count++;
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return count * amount;
  }
  return 0;
}

const NOW = new Date(2026, 5, 15);
const RULES: RecurrenceRule[] = ['monthly', 'quarterly', 'yearly', 'weekly'];

describe('addRecurrenceToMonth — équivalence avec l\'ancienne version Trésorerie', () => {
  it('donne le même résultat sur toute la matrice mois × règle × date de départ', () => {
    const starts = ['2025-01-01', '2025-11-15', '2026-01-31', '2026-06-01', '2026-06-15', '2026-09-10'];
    const ends: (string | null)[] = [null, '2026-08-31', '2026-06-20', '2030-01-01'];
    let compared = 0;

    for (const rule of RULES) {
      for (const start of starts) {
        for (const end of ends) {
          for (let m = 1; m <= 12; m++) {
            for (const year of [2025, 2026, 2027]) {
              const a = addRecurrenceToMonth(year, m, 100, start, rule, end, NOW);
              const b = legacyTresorerie(year, m, 100, start, rule, end, NOW);
              if (a !== b) {
                throw new Error(
                  `Divergence — règle=${rule} début=${start} fin=${end} mois=${year}-${m} : partagé=${a}, Trésorerie=${b}`,
                );
              }
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(3000); // la matrice a bien été parcourue
  });
});

describe('addRecurrenceToMonth — comportement attendu', () => {
  it('compte une mensualité pleine sur chaque mois de la période', () => {
    expect(addRecurrenceToMonth(2026, 6, 800, '2026-01-05', 'monthly', null, NOW)).toBe(800);
    expect(addRecurrenceToMonth(2026, 7, 800, '2026-01-05', 'monthly', null, NOW)).toBe(800);
  });

  it('ne compte rien avant le début de la récurrence', () => {
    expect(addRecurrenceToMonth(2026, 5, 800, '2026-06-01', 'monthly', null, NOW)).toBe(0);
  });

  it('ne compte rien après la date de fin', () => {
    expect(addRecurrenceToMonth(2026, 9, 800, '2026-01-05', 'monthly', '2026-08-31', NOW)).toBe(0);
    expect(addRecurrenceToMonth(2026, 8, 800, '2026-01-05', 'monthly', '2026-08-31', NOW)).toBe(800);
  });

  it('ne retient un trimestriel qu\'un mois sur trois à partir du départ', () => {
    // Départ en janvier → janvier, avril, juillet, octobre.
    expect(addRecurrenceToMonth(2026, 1, 300, '2026-01-10', 'quarterly', null, NOW)).toBe(300);
    expect(addRecurrenceToMonth(2026, 2, 300, '2026-01-10', 'quarterly', null, NOW)).toBe(0);
    expect(addRecurrenceToMonth(2026, 4, 300, '2026-01-10', 'quarterly', null, NOW)).toBe(300);
  });

  it('ne retient un annuel que sur son mois anniversaire', () => {
    expect(addRecurrenceToMonth(2026, 3, 1200, '2025-03-20', 'yearly', null, NOW)).toBe(1200);
    expect(addRecurrenceToMonth(2026, 4, 1200, '2025-03-20', 'yearly', null, NOW)).toBe(0);
  });

  it('additionne les occurrences hebdomadaires réellement contenues dans le mois', () => {
    // Départ le 1er juin 2026 : occurrences les 1, 8, 15, 22, 29 → cinq semaines.
    expect(addRecurrenceToMonth(2026, 6, 10, '2026-06-01', 'weekly', null, NOW)).toBe(50);
  });

  it('borne l\'horizon à 24 mois, même sans date de fin', () => {
    // NOW = juin 2026 → au-delà de juin 2028, une récurrence sans fin ne compte plus.
    expect(addRecurrenceToMonth(2029, 1, 500, '2026-01-01', 'monthly', null, NOW)).toBe(0);
  });
});

describe('recurrencePastInMonth — part déjà sortie du compte', () => {
  /* Distinction vitale pour le budget : ce qui est DÉJÀ passé est dans le solde et ne doit pas être
     redéduit, ce qui reste à venir doit l'être. Se tromper de côté fait compter une charge deux fois. */
  const TODAY = '2026-06-15';

  it('compte une mensualité dont le jour est déjà passé', () => {
    expect(recurrencePastInMonth(2026, 6, 800, '2026-01-05', 'monthly', null, TODAY, NOW)).toBe(800);
  });

  it('ne compte pas une mensualité dont le jour n\'est pas encore arrivé', () => {
    expect(recurrencePastInMonth(2026, 6, 800, '2026-01-25', 'monthly', null, TODAY, NOW)).toBe(0);
  });

  it('compte exactement le jour même', () => {
    expect(recurrencePastInMonth(2026, 6, 800, '2026-01-15', 'monthly', null, TODAY, NOW)).toBe(800);
  });

  it('n\'additionne que les occurrences hebdomadaires déjà écoulées', () => {
    // Occurrences de juin : 1, 8, 15, 22, 29 → trois d'entre elles sont ≤ 15.
    expect(recurrencePastInMonth(2026, 6, 10, '2026-06-01', 'weekly', null, TODAY, NOW)).toBe(30);
  });

  it('ne dépasse jamais le total du mois', () => {
    const total = addRecurrenceToMonth(2026, 6, 10, '2026-06-01', 'weekly', null, NOW);
    const past = recurrencePastInMonth(2026, 6, 10, '2026-06-01', 'weekly', null, TODAY, NOW);
    expect(past).toBeLessThanOrEqual(total);
  });

  it('replie le jour sur la fin du mois quand il n\'existe pas', () => {
    // Une récurrence au 31 tombe le 30 en juin : elle est donc passée au 15 juillet.
    expect(recurrencePastInMonth(2026, 6, 500, '2026-01-31', 'monthly', null, '2026-06-30', NOW)).toBe(500);
  });
});

describe('recurrenceOccurrencesBetween — occurrences à venir', () => {
  it('liste les échéances mensuelles strictement après la borne basse', () => {
    const occ = recurrenceOccurrencesBetween('2026-01-10', 'monthly', null, '2026-06-15', '2026-09-30');
    expect(occ).toEqual(['2026-07-10', '2026-08-10', '2026-09-10']);
  });

  it('s\'arrête à la date de fin de la récurrence', () => {
    const occ = recurrenceOccurrencesBetween('2026-01-10', 'monthly', '2026-08-01', '2026-06-15', '2026-12-31');
    expect(occ).toEqual(['2026-07-10']);
  });

  it('exclut la borne basse elle-même', () => {
    const occ = recurrenceOccurrencesBetween('2026-01-15', 'monthly', null, '2026-06-15', '2026-07-31');
    expect(occ).not.toContain('2026-06-15');
    expect(occ).toContain('2026-07-15');
  });

  it('replie sur le dernier jour des mois trop courts', () => {
    const occ = recurrenceOccurrencesBetween('2026-01-31', 'monthly', null, '2026-01-31', '2026-04-30');
    expect(occ).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('ne rend rien pour une règle sans pas mensuel connu', () => {
    expect(recurrenceOccurrencesBetween('2026-01-10', 'once' as any, null, '2026-06-15', '2026-12-31')).toEqual([]);
  });
});

/**
 * `monthlyOccurrenceCount` — le nombre d'échéances mensuelles d'un projet.
 *
 * Les deux écrans Projets le comptaient à la main avec `cursor.setMonth(cursor.getMonth() + 1)`,
 * qui DÉBORDE : partant du 31 janvier, JavaScript passe par « 31 février » et fait glisser toute la
 * série au 3 du mois. Le compte était donc faux pour toute échéance au 29, 30 ou 31 — et avec lui
 * la mensualité calculée en mode « date », qui est ENREGISTRÉE sur le projet.
 */
describe('monthlyOccurrenceCount', () => {
  it('compte les bornes INCLUSES', () => {
    expect(monthlyOccurrenceCount('2026-01-15', '2026-01-15')).toBe(1);
    expect(monthlyOccurrenceCount('2026-01-15', '2026-03-15')).toBe(3);
    expect(monthlyOccurrenceCount('2026-01-15', '2026-12-15')).toBe(12);
  });

  it('s\'arrête avant une échéance postérieure à la fin', () => {
    // L'échéance de mars tombe le 15, après le 14 → non comptée.
    expect(monthlyOccurrenceCount('2026-01-15', '2026-03-14')).toBe(2);
  });

  /* LE CAS QUI CASSAIT. Le 31 janvier → 28 février → 31 mars → 30 avril → 31 mai : cinq échéances.
     L'ancienne boucle passait par le 3 mars puis dérivait sur le 3 de chaque mois. */
  it('borne le jour au dernier du mois, SANS dériver ensuite', () => {
    expect(monthlyOccurrenceCount('2026-01-31', '2026-05-31')).toBe(5);
    expect(monthlyOccurrenceCount('2026-01-31', '2026-02-28')).toBe(2);
    // Le 30 mars existe : l'échéance de mars est bien le 31, donc au-delà du 30 → 2 seulement.
    expect(monthlyOccurrenceCount('2026-01-31', '2026-03-30')).toBe(2);
  });

  it('gère le 29 février d\'une année bissextile', () => {
    expect(monthlyOccurrenceCount('2028-01-29', '2028-02-29')).toBe(2);
    // 2026 n'est pas bissextile : l'échéance de février tombe au 28.
    expect(monthlyOccurrenceCount('2026-01-29', '2026-02-28')).toBe(2);
  });

  it('rend 0 quand la fin précède le début, ou sur une entrée illisible', () => {
    expect(monthlyOccurrenceCount('2026-05-01', '2026-01-01')).toBe(0);
    expect(monthlyOccurrenceCount('', '2026-01-01')).toBe(0);
    expect(monthlyOccurrenceCount('2026-01-01', 'pas une date')).toBe(0);
  });

  it('traverse les fins d\'année', () => {
    expect(monthlyOccurrenceCount('2026-11-10', '2027-02-10')).toBe(4);
  });
});

/**
 * `monthlyOccurrenceDates` — les DATES réellement écrites en base pour l'échéancier d'un projet.
 * C'est ici que le débordement de `setMonth` faisait le plus de dégâts.
 */
describe('monthlyOccurrenceDates', () => {
  it('garde le même jour de mois en mois', () => {
    expect(monthlyOccurrenceDates('2026-03-10', '2026-06-10'))
      .toEqual(['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10']);
  });

  /* LE CAS QUI CASSAIT : avec `cursor.setMonth(+1)`, la série était
     ['2026-01-31', '2026-03-03', '2026-04-03', '2026-05-03'] — février SAUTÉ, puis tout au 3. */
  it('ne saute AUCUN mois avec une échéance au 31, et revient au 31', () => {
    expect(monthlyOccurrenceDates('2026-01-31', '2026-05-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('borne au 29 février en année bissextile', () => {
    expect(monthlyOccurrenceDates('2028-01-31', '2028-03-31'))
      .toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('sans date de fin, génère exactement `maxCount` échéances', () => {
    const out = monthlyOccurrenceDates('2026-01-15', null, 24);
    expect(out).toHaveLength(24);
    expect(out[0]).toBe('2026-01-15');
    expect(out[23]).toBe('2027-12-15');
  });

  it('rend une liste vide sur une entrée illisible ou une fin antérieure', () => {
    expect(monthlyOccurrenceDates('', '2026-01-01')).toEqual([]);
    expect(monthlyOccurrenceDates('2026-05-01', '2026-01-01')).toEqual([]);
  });
});
