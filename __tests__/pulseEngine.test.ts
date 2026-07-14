import {
  computePulse, resolvePulseConfig, DEFAULT_PULSE_CONFIG, weekKey, monthKey, monthElapsedRatio,
  type PulseInputs,
} from '../lib/pulseEngine';
import { computeSecurityCushion } from '../lib/securityCushion';
import { computeOpFeedback } from '../lib/pulseDelta';
import type { FinancialProfileId } from '../types/database';

/** Utilisateur « médian » : tout est au vert, on dérive les cas depuis lui. */
function inputs(over: Partial<PulseInputs> = {}): PulseInputs {
  return {
    profileId: 'P3',
    today: new Date(2026, 6, 15), // 15 juillet 2026 → mois à moitié écoulé
    endOfMonthBalance: 900,
    safetyMargin: 300,
    spendingBudget: 600,
    spendingSoFar: 280,
    savingsBalance: 6000,
    savedThisMonth: 300,
    avgMonthlyIncome: 2000,
    questionnaireQ3: null,
    investedBalance: 4000,
    investedThisMonth: 200,
    investmentGains: 180,
    investCapacity: 300,
    totalWealth: 12000,
    wealth3mAgo: 11000,
    monthsWithoutOverdraft: 3,
    projects: [],
    lowConfidence: false,
    ...over,
  };
}

describe('securityCushion — base RECETTES, uniforme dans toute l’app', () => {
  it('compte des mois de REVENUS, jamais de dépenses', () => {
    const c = computeSecurityCushion({ availableSavings: 6000, avgMonthlyIncome: 2000 });
    expect(c.base).toBe('income');
    expect(c.months).toBe(3);
  });

  it('sans revenu constaté, se replie sur la tranche du questionnaire', () => {
    const c = computeSecurityCushion({
      availableSavings: 3600, avgMonthlyIncome: 0, questionnaireQ3: 'De 1 500 € à 2 500 €',
    });
    expect(c.base).toBe('questionnaire');
    expect(c.months).toBe(2); // 3600 / 1800 (borne basse prudente)
  });

  it('sans revenu ni questionnaire, ne renvoie PAS 0 mois mais « inconnu » (rien d’affiché)', () => {
    const c = computeSecurityCushion({ availableSavings: 3000, avgMonthlyIncome: 0 });
    expect(c.months).toBeNull();
    expect(c.base).toBeNull();
  });
});

describe('computePulse — les signaux dépendent du profil', () => {
  it('un débutant (P1) n’est jamais jugé sur l’investissement', () => {
    const r = computePulse(inputs({ profileId: 'P1' }));
    expect(r.signals.some((s) => s.id === 'investing')).toBe(false);
    expect(r.signals.some((s) => s.id === 'end_of_month')).toBe(true);
  });

  it('un profil confirmé (P5) est jugé sur l’investissement et le patrimoine', () => {
    const r = computePulse(inputs({ profileId: 'P5' }));
    expect(r.signals.map((s) => s.id)).toEqual(expect.arrayContaining(['investing', 'wealth']));
  });

  it('les projets perso sont montrés à TOUS les profils', () => {
    const projects = [{ id: 'p1', name: 'Japon', target: 4000, saved: 2000, progressPct: 50, onTrack: true }];
    for (const p of ['P1', 'P2', 'P3', 'P4', 'P5'] as FinancialProfileId[]) {
      const r = computePulse(inputs({ profileId: p, projects }));
      expect(r.signals.some((s) => s.id === 'projects')).toBe(true);
    }
  });

  it('sans projet, aucun signal « projets » (on n’invente pas un vide)', () => {
    const r = computePulse(inputs({ projects: [] }));
    expect(r.signals.some((s) => s.id === 'projects')).toBe(false);
  });
});

describe('computePulse — les jugements', () => {
  it('une fin de mois sous la marge passe en « à surveiller »', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: 100, safetyMargin: 300 }));
    expect(r.signals.find((x) => x.id === 'end_of_month')!.status).toBe('watch');
  });

  it('un découvert prévu passe en alerte', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: -50 }));
    expect(r.signals.find((x) => x.id === 'end_of_month')!.status).toBe('alert');
  });

  it('des dépenses au-delà du rythme du mois alertent, avec la projection en euros', () => {
    // 15/31 du mois écoulé, 500 € déjà dépensés sur 600 → projection ≈ 1033 € : ça dépasse.
    const r = computePulse(inputs({ profileId: 'P1', spendingSoFar: 500, spendingBudget: 600 }));
    const s = r.signals.find((x) => x.id === 'spending')!;
    expect(s.status).toBe('alert');
    expect(s.headline).toContain('500 €');
    expect(s.detail).toMatch(/finiras le mois/);
  });

  it('sans enveloppe estimable, les dépenses sont montrées mais PAS jugées', () => {
    const r = computePulse(inputs({ profileId: 'P1', spendingBudget: 0, spendingSoFar: 120 }));
    expect(r.signals.find((x) => x.id === 'spending')!.status).toBe('neutral');
  });

  it('en tout début de mois, un resto ne fait pas « exploser » le jugement', () => {
    // 2 juillet : 45 € dépensés → projection naïve ≈ 700 € > 600 €, mais on ne juge pas encore.
    const r = computePulse(inputs({ profileId: 'P1', today: new Date(2026, 6, 2), spendingSoFar: 45 }));
    const s = r.signals.find((x) => x.id === 'spending')!;
    expect(s.status).toBe('neutral');
    expect(s.chip).toBe('Début de mois');
  });
});

describe('computePulse — hebdo léger vs état des lieux complet', () => {
  it('l’hebdo est limité à 3 signaux : dépenses, fin de mois + le signal « du mois » du profil', () => {
    const week = computePulse(inputs({ profileId: 'P3' }), DEFAULT_PULSE_CONFIG, 'week');
    expect(week.signals.length).toBeLessThanOrEqual(3);
    expect(week.signals.map((s) => s.id)).toEqual(expect.arrayContaining(['spending', 'end_of_month']));
  });

  it('l’hebdo d’un P5 parle d’investissement, jamais de matelas ni de patrimoine', () => {
    const week = computePulse(inputs({ profileId: 'P5' }), DEFAULT_PULSE_CONFIG, 'week');
    const ids = week.signals.map((s) => s.id);
    expect(ids).toContain('investing');
    expect(ids).not.toContain('wealth');
    expect(ids).not.toContain('cushion');
  });

  it('la vue complète garde tous les signaux du profil', () => {
    const full = computePulse(inputs({ profileId: 'P5' }), DEFAULT_PULSE_CONFIG, 'full');
    expect(full.signals.map((s) => s.id)).toEqual(expect.arrayContaining(['investing', 'wealth', 'cushion']));
  });
});

describe('computePulse — orthographe de la synthèse', () => {
  it('accorde « signal / signaux » correctement (jamais « signalaux »)', () => {
    // P2 : matelas orange (1 mois), le reste au vert → 3 signaux sur 4.
    const r = computePulse(inputs({ profileId: 'P2', savingsBalance: 2000, savedThisMonth: 300, monthsWithoutOverdraft: 2 }));
    expect(r.headline).not.toMatch(/signalaux/);
    if (r.greenCount > 1) expect(r.headline).toContain(`${r.greenCount} signaux`);
  });
});

describe('computePulse — pas d’« idéal » subjectif', () => {
  it('le matelas encourage vers le PROCHAIN palier tant qu’il en reste un', () => {
    const r = computePulse(inputs({ savingsBalance: 4000, avgMonthlyIncome: 2000 })); // 2 mois
    const s = r.signals.find((x) => x.id === 'cushion')!;
    expect(s.detail).toContain('Prochain palier : 3 mois');
    expect(s.detail).not.toMatch(/idéal/i);
  });

  it('au-delà du dernier palier, aucun objectif n’est affiché', () => {
    const r = computePulse(inputs({ savingsBalance: 20000, avgMonthlyIncome: 2000 })); // 10 mois
    const s = r.signals.find((x) => x.id === 'cushion')!;
    expect(s.detail).not.toMatch(/palier/);
    expect(s.status).toBe('good');
  });

  it('l’investissement annonce ce qui était plaçable, jamais un idéal', () => {
    const r = computePulse(inputs({ profileId: 'P4', investCapacity: 400, investedThisMonth: 100 }));
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(s.detail).toContain('400 €');
    expect(s.detail).not.toMatch(/idéal/i);
    expect(s.amountLine).toContain('+180 € de gains'); // le user voit ce que ça lui a rapporté
  });
});

describe('computePulse — fiabilité', () => {
  it('des chiffres douteux ne sont JAMAIS jugés (aucun rouge)', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: -500, lowConfidence: true }));
    expect(r.estimated).toBe(true);
    expect(r.signals.every((s) => s.status === 'estimated')).toBe(true);
    expect(r.judgedCount).toBe(0);
    expect(r.headline).toMatch(/vérifie ton solde/i);
  });
});

describe('computePulse — synthèse', () => {
  it('tout au vert est détecté', () => {
    const r = computePulse(inputs({ profileId: 'P3', savingsBalance: 20000, savedThisMonth: 600, investedThisMonth: 300 }));
    expect(r.allGreen).toBe(true);
    expect(r.headline).toMatch(/au vert/i);
  });

  it('le pire statut remonte en tête', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: -50 }));
    expect(r.worst).toBe('alert');
  });
});

describe('resolvePulseConfig', () => {
  it('une config vide retombe sur les défauts', () => {
    expect(resolvePulseConfig(null)).toEqual(DEFAULT_PULSE_CONFIG);
  });

  it('un signal supprimé du code est ignoré (config stockée obsolète)', () => {
    const cfg = resolvePulseConfig({ signalsByProfile: { P1: ['cushion', 'signal_fantome'] } as any });
    expect(cfg.signalsByProfile.P1).toEqual(['cushion']);
  });

  it('un profil sans aucun signal valide retombe sur ses défauts', () => {
    const cfg = resolvePulseConfig({ signalsByProfile: { P1: ['inconnu'] } as any });
    expect(cfg.signalsByProfile.P1).toEqual(DEFAULT_PULSE_CONFIG.signalsByProfile.P1);
  });
});

describe('computeOpFeedback — la réponse à une saisie', () => {
  const before = computePulse(inputs());
  const after = computePulse(inputs({ spendingSoFar: 500 }));
  /** Node formate les milliers en espace INSÉCABLE : on normalise pour comparer du texte lisible. */
  const plain = (s: string) => s.replace(/[  ]/g, ' ');

  it('une dépense montre son effet direct, tout de suite (même sans données)', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 45 }, null, null, null, null);
    expect(f.chips[0].text).toBe('Dépense : −45 €');
    expect(f.signal).toBeNull();
  });

  it('une dépense fait remonter le signal des DÉPENSES du mois', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 220 }, before, after, 400, 180);
    expect(f.signal?.id).toBe('spending');
    expect(f.chips.some((c) => c.text.includes('Ton Relyka'))).toBe(true);
  });

  it('un virement vers l’épargne fait remonter le MATELAS', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 200, fromType: 'checking', toType: 'savings' },
      before, after, 400, 200,
    );
    expect(f.chips[0].text).toBe('Épargne : +200 €');
    expect(f.signal?.id).toBe('cushion');
  });

  it('un virement courant → courant ne fabrique aucun signal', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 100, fromType: 'checking', toType: 'checking' },
      before, after, 400, 400,
    );
    expect(f.signal).toBeNull();
    expect(f.chips[0].text).toMatch(/ton budget ne change pas/);
  });

  it('une recette annonce l’entrée d’argent', () => {
    const f = computeOpFeedback({ kind: 'income', amount: 1800 }, null, null, null, null);
    expect(plain(f.chips[0].text)).toBe('Compte courant : +1 800 €');
  });
});

describe('clés de période', () => {
  it('la semaine ISO est stable dans la semaine', () => {
    expect(weekKey(new Date(2026, 6, 13))).toBe(weekKey(new Date(2026, 6, 19))); // lundi → dimanche
    expect(weekKey(new Date(2026, 6, 20))).not.toBe(weekKey(new Date(2026, 6, 19)));
  });

  it('le mois est au format YYYY-MM', () => {
    expect(monthKey(new Date(2026, 6, 15))).toBe('2026-07');
  });

  it('la part du mois écoulée n’est jamais nulle (division sûre)', () => {
    expect(monthElapsedRatio(new Date(2026, 6, 1))).toBeGreaterThan(0);
    expect(monthElapsedRatio(new Date(2026, 6, 31))).toBe(1);
  });
});
