import {
  computePulse, resolvePulseConfig, DEFAULT_PULSE_CONFIG, PULSE_SIGNAL_IDS,
  monthKey, type PulseInputs,
} from '../lib/pulseEngine';
import { computeSecurityCushion } from '../lib/securityCushion';
import { computeOpFeedback } from '../lib/pulseDelta';
import type { FinancialProfileId } from '../types/database';

/** Utilisateur « médian » : on dérive les cas depuis lui. */
function inputs(over: Partial<PulseInputs> = {}): PulseInputs {
  return {
    profileId: 'P3',
    today: new Date(2026, 6, 15), // 15 juillet 2026
    endOfMonthBalance: 900,
    safetyMargin: 300,
    spendingBudget: 600,
    spendingSoFar: 280,
    savingsBalance: 6000,
    avgMonthlyIncome: 2000,
    questionnaireQ3: null,
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   AUCUN JUGEMENT — la règle n°1 de l'état des lieux.
   Il n'y a plus ni statut, ni pastille, ni couleur, ni note globale : que des constats.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe('computePulse — un ÉTAT, jamais un jugement', () => {
  it('aucun signal ne porte de statut ni de pastille d’état', () => {
    const r = computePulse(inputs());
    for (const s of r.signals) {
      expect(s).not.toHaveProperty('status');
      expect(s).not.toHaveProperty('chip');
    }
  });

  it('le résultat ne compte ni verts ni signaux « jugés »', () => {
    const r = computePulse(inputs());
    expect(r).not.toHaveProperty('greenCount');
    expect(r).not.toHaveProperty('judgedCount');
    expect(r).not.toHaveProperty('allGreen');
    expect(r).not.toHaveProperty('worst');
  });

  it('un découvert prévu se dit, sans être classé « alerte »', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: -50 }));
    const s = r.signals.find((x) => x.id === 'end_of_month')!;
    expect(s.headline).toContain('-50 €');
    expect(s.detail).toContain('sous ta marge de sécurité');
  });

  it('« Épargne du mois » et « Investissement du mois » n’existent plus comme signaux', () => {
    expect(PULSE_SIGNAL_IDS).not.toContain('saving' as any);
    expect(PULSE_SIGNAL_IDS).not.toContain('investing' as any);
  });
});

describe('computePulse — les signaux dépendent du profil', () => {
  it('les deux repères du mois sont toujours là, quel que soit le profil', () => {
    for (const p of ['P1', 'P2', 'P3', 'P4', 'P5'] as FinancialProfileId[]) {
      const ids = computePulse(inputs({ profileId: p })).signals.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['spending', 'cushion']));
    }
  });

  it('un profil confirmé (P5) voit son patrimoine', () => {
    const r = computePulse(inputs({ profileId: 'P5' }));
    expect(r.signals.map((s) => s.id)).toContain('wealth');
  });

  it('les projets perso sont montrés à TOUS les profils', () => {
    const projects = [{ id: 'p1', name: 'Japon', target: 4000, saved: 2000, progressPct: 50 }];
    for (const p of ['P1', 'P2', 'P3', 'P4', 'P5'] as FinancialProfileId[]) {
      const r = computePulse(inputs({ profileId: p, projects }));
      expect(r.signals.some((s) => s.id === 'projects')).toBe(true);
    }
  });

  it('sans projet, aucun signal « projets » (on n’invente pas un vide)', () => {
    const r = computePulse(inputs({ projects: [] }));
    expect(r.signals.some((s) => s.id === 'projects')).toBe(false);
  });

  it('avec plusieurs projets, on montre le plus AVANCÉ et on compte les autres', () => {
    const projects = [
      { id: 'a', name: 'Avance', target: 1000, saved: 900, progressPct: 90 },
      { id: 'b', name: 'Débute', target: 2000, saved: 200, progressPct: 10 },
    ];
    const s = computePulse(inputs({ projects })).signals.find((x) => x.id === 'projects')!;
    expect(s.headline).toContain('Avance');
    expect(s.amountLine).toContain('1 autre projet');
  });
});

describe('computePulse — les constats', () => {
  it('les dépenses variables se comparent au budget habituel, sans projeter un « rythme »', () => {
    const s = computePulse(inputs({ spendingSoFar: 720, spendingBudget: 600 }))
      .signals.find((x) => x.id === 'spending')!;
    expect(s.headline).toContain('720 €');
    expect(s.headline).toContain('habituels');
    expect(s.detail).toContain('120 € de plus');
    expect(s.detail).not.toMatch(/rythme|finirais/); // plus aucune projection
  });

  it('sous le budget habituel, on dit l’écart dans l’autre sens', () => {
    const s = computePulse(inputs({ spendingSoFar: 450, spendingBudget: 600 }))
      .signals.find((x) => x.id === 'spending')!;
    expect(s.detail).toContain('150 € de moins');
  });

  it('sans budget variable estimable, on montre le montant sans comparaison', () => {
    const s = computePulse(inputs({ spendingBudget: 0, spendingSoFar: 120 }))
      .signals.find((x) => x.id === 'spending')!;
    expect(s.headline).toContain('120 €');
    expect(s.detail).not.toMatch(/de plus|de moins/);
  });

  it('la marge de sécurité en fin de mois se lit « au-dessus de ta marge »', () => {
    const s = computePulse(inputs({ endOfMonthBalance: 900, safetyMargin: 300 }))
      .signals.find((x) => x.id === 'end_of_month')!;
    expect(s.detail).toContain('au-dessus de ta marge de sécurité');
  });

  it('le matelas chiffre le prochain palier : épargne actuelle / épargne visée', () => {
    const s = computePulse(inputs({ savingsBalance: 4000, avgMonthlyIncome: 2000 })) // 2 mois
      .signals.find((x) => x.id === 'cushion')!;
    const detail = s.detail!.replace(/\s/g, ' '); // normalise les espaces insécables de toLocaleString
    expect(detail).toContain('Prochain palier : 3 mois');
    expect(detail).toContain('4 000 € / ~6 000 €'); // 3 mois × 2000 € de revenu
    expect(detail).not.toMatch(/idéal/i);
  });

  it('au-delà du dernier palier, aucun objectif n’est affiché', () => {
    const s = computePulse(inputs({ savingsBalance: 20000, avgMonthlyIncome: 2000 })) // 10 mois
      .signals.find((x) => x.id === 'cushion')!;
    expect(s.detail).not.toMatch(/palier/);
    expect(s.progress).toBe(1);
  });
});

describe('computePulse — fiabilité', () => {
  it('des chiffres douteux marquent le bilan « estimé », sans rien retirer', () => {
    const r = computePulse(inputs({ endOfMonthBalance: -500, lowConfidence: true }));
    expect(r.estimated).toBe(true);
    expect(r.signals.length).toBeGreaterThan(0);
  });
});

describe('resolvePulseConfig', () => {
  it('une config vide retombe sur les défauts', () => {
    expect(resolvePulseConfig(null)).toEqual(DEFAULT_PULSE_CONFIG);
  });

  it('chaque profil affiche 5 signaux par défaut', () => {
    for (const ids of Object.values(DEFAULT_PULSE_CONFIG.signalsByProfile)) {
      expect(ids).toHaveLength(5);
    }
  });

  it('un signal supprimé du code est ignoré (config stockée obsolète : saving / investing)', () => {
    const cfg = resolvePulseConfig({ signalsByProfile: { P1: ['cushion', 'saving', 'investing'] } as any });
    expect(cfg.signalsByProfile.P1).toEqual(['cushion']);
  });

  it('un profil sans aucun signal valide retombe sur ses défauts', () => {
    const cfg = resolvePulseConfig({ signalsByProfile: { P1: ['inconnu'] } as any });
    expect(cfg.signalsByProfile.P1).toEqual(DEFAULT_PULSE_CONFIG.signalsByProfile.P1);
  });

  it('les anciens réglages (hebdo, repères) sont simplement ignorés', () => {
    const cfg = resolvePulseConfig({ weekly: true, benchmarks: { P1: {} } } as any);
    expect(cfg).not.toHaveProperty('weekly');
    expect(cfg).not.toHaveProperty('benchmarks');
    expect(cfg).not.toHaveProperty('weeklyPush');
  });
});

describe('computeOpFeedback — la réponse à une saisie', () => {
  /** Node formate les milliers en espace INSÉCABLE (fin ou normal) : on normalise pour comparer. */
  const plain = (s: string) => s.replace(/\s/g, ' ');

  it('une dépense montre son effet direct, tout de suite (même sans données)', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 45 }, null, null);
    expect(f.chips[0].text).toBe('Dépense : −45 €');
  });

  it('chiffres pas encore sûrs : le Relyka garde un tiret, jamais une valeur périmée', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 220 }, 400, null);
    expect(plain(f.chips.find((c) => c.key === 'relyka')!.text)).toBe('Ton Relyka : —');
  });

  it('à l’arrivée des chiffres, le Relyka se remplit', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 220 }, 400, 180);
    expect(plain(f.chips.find((c) => c.key === 'relyka')!.text)).toBe('Ton Relyka : 180 €');
  });

  it('un virement vers l’épargne annonce où va l’argent', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 200, fromType: 'checking', toType: 'savings' }, 400, 200,
    );
    expect(f.chips[0].text).toBe('Épargne : +200 €');
    expect(f.chips[0].tone).toBe('positive');
  });

  it('un virement vers l’investissement aussi', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 200, fromType: 'checking', toType: 'investment' }, 400, 200,
    );
    expect(f.chips[0].text).toBe('Investi : +200 €');
  });

  it('un virement courant → courant dit que le budget ne bouge pas', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 100, fromType: 'checking', toType: 'checking' }, 400, 400,
    );
    expect(f.chips[0].text).toMatch(/ton budget ne change pas/);
    expect(f.chips[0].tone).toBe('neutral');
  });

  it('une recette annonce l’entrée d’argent', () => {
    const f = computeOpFeedback({ kind: 'income', amount: 1800 }, null, null);
    expect(plain(f.chips[0].text)).toBe('Compte courant : +1 800 €');
  });

  it('une plus-value saisie sur un compte d’investissement ne dit PAS « compte courant »', () => {
    const f = computeOpFeedback({ kind: 'income', amount: 200, accountType: 'investment' }, null, null);
    expect(f.chips[0].text).toBe('Investissement : +200 €');
  });

  it('un Relyka tombé à zéro se signale, sans juger l’état des lieux', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 500 }, 400, 0);
    expect(f.chips.find((c) => c.key === 'relyka')!.tone).toBe('negative');
  });
});

describe('clé de mois', () => {
  it('le mois est au format YYYY-MM', () => {
    expect(monthKey(new Date(2026, 6, 15))).toBe('2026-07');
  });
});
