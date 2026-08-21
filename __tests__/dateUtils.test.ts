/**
 * Dates — les deux pièges qui reviennent sans cesse dans ce dépôt.
 *
 *  1. `toISOString()` convertit en UTC : après 22 h en France, il renvoie la VEILLE (→ `isoDay`).
 *  2. `new Date('2026-08-15')` est parsé en UTC puis relu en heure locale : à l'OUEST de Greenwich,
 *     `getDate()` rend le jour d'avant (→ `dayOfMonthISO`).
 *
 * Le second traînait dans cinq calculs, dont l'écriture du jour d'échéance d'un projet — une
 * colonne PERSISTÉE. Ces tests échouent si l'on repasse par `Date`, quel que soit le fuseau de la
 * machine qui les exécute.
 */
import { isoDay, todayISO, dayOfMonthISO, formatDateFrench, parseDateFromFrench } from '../lib/dateUtils';

describe('isoDay — la date en heure LOCALE', () => {
  it('rend la date locale, pas la date UTC', () => {
    // 23 h 30 le 21 août, heure locale : `toISOString()` dirait « 22 » à l'est de Greenwich.
    const d = new Date(2026, 7, 21, 23, 30, 0);
    expect(isoDay(d)).toBe('2026-08-21');
  });

  it('rend la date locale juste après minuit', () => {
    expect(isoDay(new Date(2026, 7, 21, 0, 15, 0))).toBe('2026-08-21');
  });

  it('complète les mois et jours à deux chiffres', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('todayISO suit la même convention', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISO()).toBe(isoDay(new Date()));
  });
});

describe('dayOfMonthISO — le jour du mois, lu sur la CHAÎNE', () => {
  it('rend le jour tel qu\'il est écrit', () => {
    expect(dayOfMonthISO('2026-08-15')).toBe(15);
    expect(dayOfMonthISO('2026-01-01')).toBe(1);
    expect(dayOfMonthISO('2026-12-31')).toBe(31);
  });

  it('accepte une date horodatée', () => {
    expect(dayOfMonthISO('2026-08-15T09:30:00Z')).toBe(15);
  });

  /* Le cœur du correctif : `new Date('2026-03-01').getDate()` vaut 28 ou 29 (février) dans un
     fuseau négatif. Ici, la valeur ne dépend d'aucun fuseau. */
  it('ne dépend PAS du fuseau de la machine', () => {
    expect(dayOfMonthISO('2026-03-01')).toBe(1);
    expect(dayOfMonthISO('2026-01-01')).toBe(1);
  });

  it('rend 0 sur une entrée inexploitable — à l\'appelant de choisir son repli', () => {
    expect(dayOfMonthISO(null)).toBe(0);
    expect(dayOfMonthISO(undefined)).toBe(0);
    expect(dayOfMonthISO('')).toBe(0);
    expect(dayOfMonthISO('pas une date')).toBe(0);
    expect(dayOfMonthISO('2026-08-00')).toBe(0); // jour 0 : hors bornes
  });
});

describe('formatDateFrench / parseDateFromFrench', () => {
  it('fait l\'aller-retour ISO → français → ISO', () => {
    expect(formatDateFrench('2026-08-21')).toBe('21-08-2026');
    expect(parseDateFromFrench('21-08-2026')).toBe('2026-08-21');
    expect(parseDateFromFrench('21/08/2026')).toBe('2026-08-21');
    expect(parseDateFromFrench('21082026')).toBe('2026-08-21');
  });

  it('refuse ce qui n\'est pas une date', () => {
    expect(parseDateFromFrench('')).toBe('');
    expect(parseDateFromFrench('2108')).toBe('');       // incomplet
    expect(parseDateFromFrench('32-08-2026')).toBe(''); // jour hors bornes
    expect(parseDateFromFrench('21-13-2026')).toBe(''); // mois hors bornes
    expect(parseDateFromFrench('31-02-2026')).toBe(''); // 31 février n'existe pas
  });

  it('laisse passer une entrée vide sans lever', () => {
    expect(formatDateFrench('')).toBe('');
  });
});

describe('parseDateFromFrench — années bissextiles', () => {
  it('accepte le 29 février d\'une année bissextile', () => {
    expect(parseDateFromFrench('29-02-2028')).toBe('2028-02-29');
  });

  it('refuse le 29 février d\'une année ordinaire', () => {
    expect(parseDateFromFrench('29-02-2026')).toBe('');
  });

  it('refuse le 31 d\'un mois de 30 jours', () => {
    expect(parseDateFromFrench('31-04-2026')).toBe('');
    expect(parseDateFromFrench('31-11-2026')).toBe('');
  });
});
