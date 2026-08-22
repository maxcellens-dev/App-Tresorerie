/**
 * Métriques de succès — le MÊME calcul sert à débloquer (GamificationSync) et à afficher la
 * progression « 7/12 » (écran Succès). S'ils divergent, la barre ment.
 */
import { transactionMetrics, closureMetrics, accountAgeDays, buildBadgeMetrics } from '../lib/engagement/badgeMetrics';

const checking = { type: 'checking' };
const invest = { type: 'investment' };

describe('closureMetrics', () => {
  it('ne compte que les mois CONFIRMÉS (un mois « estimé » n’est pas clôturé)', () => {
    const r = closureMetrics([
      { month_key: '2026-01', status: 'confirmed' },
      { month_key: '2026-02', status: 'estimated' },
      { month_key: '2026-03', status: 'confirmed' },
    ]);
    expect(r.closures_count).toBe(2);
    expect(r.consecutive_closures).toBe(1); // janvier et mars ne se suivent pas
  });

  it('trouve la plus longue suite de mois consécutifs, même à cheval sur une année', () => {
    const r = closureMetrics([
      { month_key: '2025-11' }, { month_key: '2025-12' },
      { month_key: '2026-01' }, { month_key: '2026-02' },
      { month_key: '2026-05' },
    ]);
    expect(r.closures_count).toBe(5);
    expect(r.consecutive_closures).toBe(4);
  });

  it('résiste aux doublons et aux clés illisibles', () => {
    const r = closureMetrics([
      { month_key: '2026-01' }, { month_key: '2026-01' },
      { month_key: 'bidon' as any }, { month_key: '' as any },
    ]);
    expect(r.closures_count).toBe(1);
    expect(r.consecutive_closures).toBe(1);
  });

  it('rend 0 sans aucune clôture', () => {
    expect(closureMetrics([])).toEqual({ closures_count: 0, consecutive_closures: 0 });
  });
});

describe('transactionMetrics', () => {
  const now = new Date(2026, 2, 15); // 15 mars 2026

  it('compte les virements vers un compte d’investissement, et eux seuls', () => {
    const r = transactionMetrics([
      { amount: -200, date: '2026-01-10', account: checking, linked_account: invest },
      { amount: -100, date: '2026-01-12', account: checking, linked_account: { type: 'savings' } },
      { amount: 300, date: '2026-01-15', account: checking, linked_account: invest },   // entrant → non
      { amount: -50, date: '2026-01-20', account: invest, linked_account: invest },      // pas depuis un courant
      { amount: -80, date: '2026-02-01', account: checking, linked_account: invest, is_draft: true }, // brouillon
    ], now);
    expect(r.invest_followed).toBe(1);
  });

  it('compte les mois passés consécutifs en excédent, en partant du plus récent', () => {
    const r = transactionMetrics([
      { amount: 1000, date: '2025-12-05', account: checking },
      { amount: -400, date: '2025-12-20', account: checking },   // décembre : +600
      { amount: 1000, date: '2026-01-05', account: checking },
      { amount: -1200, date: '2026-01-20', account: checking },  // janvier : -200
      { amount: 900, date: '2026-02-05', account: checking },    // février : +900
    ], now);
    expect(r.surplus_months_streak).toBe(1); // février OK, janvier casse la série
  });

  it('ignore le mois EN COURS (il n’est pas terminé)', () => {
    const r = transactionMetrics([
      { amount: 5000, date: '2026-03-01', account: checking },
    ], now);
    expect(r.surplus_months_streak).toBe(0);
  });

  it('ne se laisse pas empoisonner par un montant illisible', () => {
    const r = transactionMetrics([
      { amount: 'abc' as any, date: '2026-02-01', account: checking },
      { amount: 500, date: '2026-02-02', account: checking },
    ], now);
    expect(r.surplus_months_streak).toBe(1);
  });

  it('rend 0 sans aucune transaction', () => {
    expect(transactionMetrics([], now)).toEqual({ invest_followed: 0, surplus_months_streak: 0 });
  });
});

describe('accountAgeDays', () => {
  const now = new Date(2026, 7, 22);
  it('mesure l’ancienneté en jours', () => {
    expect(accountAgeDays(new Date(2026, 6, 23).toISOString(), now)).toBe(30);
  });
  it('rend 0 (et jamais NaN) sans date ou avec une date illisible', () => {
    expect(accountAgeDays(null, now)).toBe(0);
    expect(accountAgeDays('pas-une-date', now)).toBe(0);
  });
  it('ne rend jamais de valeur négative (date dans le futur)', () => {
    expect(accountAgeDays(new Date(2027, 0, 1).toISOString(), now)).toBe(0);
  });
});

describe('buildBadgeMetrics', () => {
  it('rend toutes les métriques, y compris à vide — aucune ne doit être undefined', () => {
    const m = buildBadgeMetrics({});
    expect(m).toEqual({
      invest_followed: 0,
      surplus_months_streak: 0,
      closures_count: 0,
      consecutive_closures: 0,
      account_age_days: 0,
      profile_photo: 0,
      onboarding_done: 0,
    });
  });
});
