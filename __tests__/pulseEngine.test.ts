import {
  computePulse, resolvePulseConfig, DEFAULT_PULSE_CONFIG, PULSE_SIGNAL_IDS,
  weekKey, monthKey, monthElapsedRatio, type PulseInputs,
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

  it('un projet en saisie manuelle (onTrack null) est NEUTRE, jamais « dans les temps »', () => {
    const projects = [{ id: 'p', name: 'Voiture', target: 1500, saved: 200, progressPct: 13, onTrack: null }];
    const s = computePulse(inputs({ projects })).signals.find((x) => x.id === 'projects')!;
    expect(s.status).toBe('neutral');
    expect(s.chip).toBe('En cours');
  });

  it('un projet en retard (onTrack false) est mis en avant et signalé', () => {
    const projects = [
      { id: 'a', name: 'Avance', target: 1000, saved: 900, progressPct: 90, onTrack: true },
      { id: 'b', name: 'Retard', target: 2000, saved: 200, progressPct: 10, onTrack: false },
    ];
    const s = computePulse(inputs({ projects })).signals.find((x) => x.id === 'projects')!;
    expect(s.status).toBe('watch');
    expect(s.headline).toContain('Retard');
    expect(s.chip).toBe('En retard');
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
    // Projection → CONDITIONNEL (« finirais »), et enveloppe « estimée » (pas « prévue »).
    expect(s.detail).toMatch(/finirais le mois/);
    expect(s.headline).toContain('estimés');
  });

  it('sans enveloppe estimable, les dépenses sont montrées mais PAS jugées', () => {
    const r = computePulse(inputs({ profileId: 'P1', spendingBudget: 0, spendingSoFar: 120 }));
    expect(r.signals.find((x) => x.id === 'spending')!.status).toBe('neutral');
  });

  it('enveloppe DÉJÀ dépassée : constat (pas projection) avec le montant de dépassement', () => {
    const r = computePulse(inputs({ profileId: 'P1', spendingBudget: 400, spendingSoFar: 520 }));
    const s = r.signals.find((x) => x.id === 'spending')!;
    expect(s.status).toBe('alert');
    expect(s.chip).toBe('Budget dépassé');
    expect(s.detail).toContain('dépassé ton estimation variable de 120 €');
    expect(s.detail).not.toMatch(/rythme|finirais/); // plus une projection : c'est un fait
  });

  it('la marge de sécurité en fin de mois se lit « au-dessus de ta marge »', () => {
    const r = computePulse(inputs({ profileId: 'P1', endOfMonthBalance: 900, safetyMargin: 300 }));
    const s = r.signals.find((x) => x.id === 'end_of_month')!;
    expect(s.detail).toContain('au-dessus de ta marge de sécurité');
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
  it('le matelas chiffre le prochain palier : épargne actuelle / épargne visée', () => {
    const r = computePulse(inputs({ savingsBalance: 4000, avgMonthlyIncome: 2000 })); // 2 mois
    const s = r.signals.find((x) => x.id === 'cushion')!;
    const detail = s.detail!.replace(/\s/g, ' '); // normalise les espaces insécables de toLocaleString
    expect(detail).toContain('Prochain palier : 3 mois');
    expect(detail).toContain('4 000 € / ~6 000 €'); // 3 mois × 2000 € de revenu
    expect(detail).not.toMatch(/idéal/i);
    expect(s.amountLine).toBeUndefined(); // plus de « Épargne totale » sous la barre
  });

  it('au-delà du dernier palier, aucun objectif n’est affiché', () => {
    const r = computePulse(inputs({ savingsBalance: 20000, avgMonthlyIncome: 2000 })); // 10 mois
    const s = r.signals.find((x) => x.id === 'cushion')!;
    expect(s.detail).not.toMatch(/palier/);
    expect(s.status).toBe('good');
  });

  it('l’investissement annonce le RESTANT plaçable, jamais un idéal', () => {
    // Capacité 400, 100 placés → le détail parle des 300 restants (pas de la capacité brute :
    // « jusqu'à 400 € » après avoir placé 100 lisait comme 400 de PLUS).
    const r = computePulse(inputs({ profileId: 'P4', investCapacity: 400, investedThisMonth: 100 }));
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(s.detail).toContain('300 €');
    expect(s.detail).not.toMatch(/idéal/i);
    expect(s.amountLine).toContain('+180 € de gains'); // le user voit ce que ça lui a rapporté
  });

  it('une capacité d’investissement dérisoire (< 20 €) n’est pas jugée en rouge', () => {
    const r = computePulse(inputs({ profileId: 'P4', investCapacity: 8, investedThisMonth: 0 }));
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(s.status).toBe('neutral');
    expect(s.detail).toMatch(/ne laisse plus de place/);
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

  it('un projet NEUTRE (saisie manuelle) ne bloque pas la validation « tout au vert »', () => {
    // Tous les signaux jugés au vert, + un projet manuel (neutre/bleu) → allGreen doit rester vrai.
    const projects = [{ id: 'p', name: 'Voiture', target: 1500, saved: 200, progressPct: 13, onTrack: null }];
    const r = computePulse(inputs({
      profileId: 'P3', savingsBalance: 20000, savedThisMonth: 600, investedThisMonth: 300, projects,
    }));
    expect(r.signals.some((s) => s.id === 'projects' && s.status === 'neutral')).toBe(true);
    expect(r.allGreen).toBe(true); // le projet neutre est HORS des signaux jugés
    // Validation mensuelle = green_count === judged_count (le neutre n'entre pas dans judged).
    expect(r.greenCount).toBe(r.judgedCount);
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
  // Pool LIVE : TOUS les signaux (comme usePulse.live) → une saisie d'épargne peut montrer la carte
  // « Épargne » même si le profil ne l'affiche pas dans son état des lieux.
  const allCfg = {
    ...DEFAULT_PULSE_CONFIG,
    signalsByProfile: { ...DEFAULT_PULSE_CONFIG.signalsByProfile, P3: [...PULSE_SIGNAL_IDS] },
  };
  const before = computePulse(inputs(), allCfg, 'full');
  const after = computePulse(inputs({ spendingSoFar: 500 }), allCfg, 'full');
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

  it('épargne : les virements À VENIR du mois comptent dans le jugement et remplissent le segment « prévu »', () => {
    // 0 € fait mais 400 € programmés (cible 15 % × 2000 = 300) → « Bien épargné », pas rouge.
    const r = computePulse(inputs({ savedThisMonth: 0, savingsPlannedThisMonth: 400 }), allCfg, 'full');
    const s = r.signals.find((x) => x.id === 'saving')!;
    expect(s.status).toBe('good');
    expect(s.progress?.value).toBe(0);
    expect(s.progress?.planned).toBeGreaterThan(0);
    expect(plain(s.detail ?? '')).toContain('400 € encore prévus');
  });

  it('investissement : un virement programmé évite le « À lancer » et s’annonce dans le titre', () => {
    // Rien de placé mais 250 € prévus sur 300 de capacité (seuil 60 % = 180) → good.
    const r = computePulse(inputs({ investedThisMonth: 0, investPlannedThisMonth: 250 }), allCfg, 'full');
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(s.status).toBe('good');
    expect(plain(s.headline)).toContain('250 € d’investissement prévus');
    expect(s.progress?.planned).toBeGreaterThan(0);
  });

  it('investissement : capacité ÉPUISÉE (placé = capacité, reco à 0) → jamais « tu pourrais placer X »', () => {
    // Cas réel : virement invest de 25 €, la reco « Investir » tombe sous son seuil → capacité = 25
    // (= le placé). Dire « tu pourrais placer jusqu'à 25 € » contredirait les recos (Conserver seul).
    const r = computePulse(inputs({ investedThisMonth: 25, investCapacity: 25 }), allCfg, 'full');
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(plain(s.detail ?? '')).toContain('pas conseillé d\'investir plus');
    expect(plain(s.detail ?? '')).not.toContain('pourrais placer');
  });

  it('investissement : détail = le RESTANT plaçable, pas la capacité brute', () => {
    // 200 placés sur 300 de capacité → « encore 100 € », pas « jusqu'à 300 € ».
    const r = computePulse(inputs(), allCfg, 'full');
    const s = r.signals.find((x) => x.id === 'investing')!;
    expect(plain(s.detail ?? '')).toContain('encore placer 100 €');
  });

  it('une dépense ne fait jamais remonter une bascule « Investissement » (effet dérivé de la capacité)', () => {
    // La dépense réduit le budget libre → la CAPACITÉ d'investissement baisse → le ratio placé/capacité
    // passe au vert tout seul. Vrai mécaniquement, absurde à annoncer après une dépense.
    const b = computePulse(inputs({ investedThisMonth: 100 }), allCfg, 'full'); // sous le seuil → watch
    const a = computePulse(inputs({ investedThisMonth: 100, investCapacity: 150, spendingSoFar: 500 }), allCfg, 'full'); // capacité réduite → good
    const f = computeOpFeedback({ kind: 'expense', amount: 220 }, b, a, 400, 180);
    expect(f.signal?.id).toBe('spending');
    expect(f.chips.some((c) => plain(c.text).includes('Investissement'))).toBe(false);
  });

  it('un retrait sur l’épargne montre le MATELAS, pas l’enveloppe variable', () => {
    const f = computeOpFeedback({ kind: 'expense', amount: 220, accountType: 'savings' }, before, after, 400, 180);
    expect(f.signal?.id).toBe('cushion');
  });

  it('un virement vers l’épargne montre la carte ÉPARGNE (pas Fin de mois)', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 200, fromType: 'checking', toType: 'savings' },
      before, after, 400, 200,
    );
    expect(f.chips[0].text).toBe('Épargne : +200 €');
    expect(f.signal?.id).toBe('saving');
  });

  it('un virement vers l’investissement montre la carte INVESTISSEMENT', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 200, fromType: 'checking', toType: 'investment' },
      before, after, 400, 200,
    );
    expect(f.chips[0].text).toBe('Investi : +200 €');
    expect(f.signal?.id).toBe('investing');
  });

  it('un virement courant → courant garde la carte FIN DE MOIS', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 100, fromType: 'checking', toType: 'checking' },
      before, after, 400, 400,
    );
    expect(f.signal?.id).toBe('end_of_month');
    expect(f.chips[0].text).toMatch(/ton budget ne change pas/);
  });

  it('une recette annonce l’entrée d’argent', () => {
    const f = computeOpFeedback({ kind: 'income', amount: 1800 }, null, null, null, null);
    expect(plain(f.chips[0].text)).toBe('Compte courant : +1 800 €');
  });

  it('une plus-value saisie sur un compte d’investissement ne dit PAS « compte courant »', () => {
    const f = computeOpFeedback({ kind: 'income', amount: 200, accountType: 'investment' }, null, null, null, null);
    expect(f.chips[0].text).toBe('Investissement : +200 €');
  });

  it('un virement invest daté dans le futur ne montre pas « rien de placé » : seule la fin de mois est impactée', () => {
    const f = computeOpFeedback(
      { kind: 'transfer', amount: 100, fromType: 'checking', toType: 'investment', isFuture: true },
      before, after, 400, 300,
    );
    expect(f.signal?.id).toBe('end_of_month');
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
