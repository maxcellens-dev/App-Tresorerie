/**
 * Ordre d'affichage des transactions, et JOUR auquel une ligne se range.
 *
 * Ces deux calculs étaient recopiés dans l'écran Transactions (donc hors de portée d'un test), en
 * plus de la version que le détail d'un compte importait déjà. Ils décident de deux choses
 * visibles : l'ordre des lignes, et la frontière entre « passé » et « à venir ».
 */
import { compareTransactionsForDisplay, getEffectiveDate } from '../lib/finance/txOrder';

describe('getEffectiveDate — le jour où la ligne se range', () => {
  it('rend la date telle quelle pour une ligne ordinaire', () => {
    expect(getEffectiveDate({ date: '2026-08-21' })).toBe('2026-08-21');
  });

  it('reporte le jour du modèle dans le mois de l\'occurrence dépliée', () => {
    expect(getEffectiveDate({ date: '2026-01-15', displayDate: '2026-08' })).toBe('2026-08-15');
  });

  it('borne au dernier jour du mois : un « 31 » tombe au 28 en février', () => {
    expect(getEffectiveDate({ date: '2026-01-31', displayDate: '2026-02' })).toBe('2026-02-28');
    expect(getEffectiveDate({ date: '2026-01-31', displayDate: '2026-04' })).toBe('2026-04-30');
  });

  /* ⚠️ LE PIÈGE DE FUSEAU. `new Date('2026-08-31')` est parsé en UTC : à l'ouest de Greenwich,
     `getDate()` renvoyait 30 — l'occurrence se rangeait la veille, et pouvait basculer du mauvais
     côté de la frontière passé / à venir. Ce test échoue si on repasse à un parsing UTC, quel que
     soit le fuseau de la machine qui l'exécute. */
  it('lit le jour en heure LOCALE, jamais en UTC', () => {
    expect(getEffectiveDate({ date: '2026-08-31', displayDate: '2026-08' })).toBe('2026-08-31');
    expect(getEffectiveDate({ date: '2026-03-01', displayDate: '2026-03' })).toBe('2026-03-01');
  });

  it('accepte une date horodatée (on ne lit que la partie jour)', () => {
    expect(getEffectiveDate({ date: '2026-01-15T09:30:00Z', displayDate: '2026-08' })).toBe('2026-08-15');
  });
});

describe('compareTransactionsForDisplay', () => {
  const sorted = (rows: any[]) => [...rows].sort(compareTransactionsForDisplay).map((r) => r.id);

  it('range le jour le plus récent en haut', () => {
    expect(sorted([
      { id: 'vieux', date: '2026-08-01' },
      { id: 'recent', date: '2026-08-20' },
    ])).toEqual(['recent', 'vieux']);
  });

  it('à jour égal : la saisie la plus récente en haut', () => {
    expect(sorted([
      { id: 'a', date: '2026-08-10', created_at: '2026-08-10T08:00:00Z' },
      { id: 'b', date: '2026-08-10', created_at: '2026-08-10T18:00:00Z' },
    ])).toEqual(['b', 'a']);
  });

  it('pousse les lignes « déjà incluses » dans une régul tout en bas de leur jour', () => {
    expect(sorted([
      { id: 'couverte', date: '2026-08-10', created_at: '2026-08-10T23:00:00Z', regul_covered: true },
      { id: 'normale', date: '2026-08-10', created_at: '2026-08-10T08:00:00Z' },
    ])).toEqual(['normale', 'couverte']);
  });

  /* Le comparateur trie sur la date EFFECTIVE : sinon toutes les occurrences dépliées d'une même
     récurrente se rangeaient au jour du MODÈLE, donc au même endroit. */
  it('classe une occurrence dépliée à son jour d\'affichage, pas à celui du modèle', () => {
    expect(sorted([
      { id: 'ponctuelle', date: '2026-08-05' },
      { id: 'occurrence', date: '2026-01-25', displayDate: '2026-08' },
    ])).toEqual(['occurrence', 'ponctuelle']);
  });

  it('laisse inchangé l\'ordre des lignes ordinaires (le détail de compte ne bouge pas)', () => {
    expect(sorted([
      { id: 'x', date: '2026-08-03', created_at: '2026-08-03T10:00:00Z' },
      { id: 'y', date: '2026-08-03', created_at: '2026-08-03T11:00:00Z' },
      { id: 'z', date: '2026-08-04', created_at: '2026-08-04T09:00:00Z' },
    ])).toEqual(['z', 'y', 'x']);
  });
});
