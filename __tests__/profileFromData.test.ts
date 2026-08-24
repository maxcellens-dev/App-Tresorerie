import {
  computeProfileFromData,
  PROFILE_ALLOCATIONS,
  PROFILE_INFO,
  PROFILE_TO_TIER,
  FINANCIAL_PROFILE_IDS,
  RANKED_PROFILE_IDS,
  PROFILE_TRANSITION_KEYS,
  isMillionaire,
  resolveProfileId,
  resolveLiveProfile,
  DEFAULT_PROFILE_THRESHOLDS,
  thresholdsFromMatrix,
  type ProfileDataInputs,
} from '../lib/finance/financialProfileEngine';
import type { FinancialProfileId } from '../types/database';

/**
 * LE PROFIL RÉPOND À QUATRE QUESTIONS, DANS CET ORDRE.
 *
 *   1. la situation est-elle VIABLE ?        revenu vs dépenses essentielles     → sinon P1
 *   2. combien de temps tient-il ?           épargne ÷ dépenses essentielles     → P2 … P5
 *   3. investit-il RÉELLEMENT ?              oui / non                           → P6
 *   4. quelle taille fait le patrimoine ?    30k / 100k / 300k                   → P7 … P9
 *
 * Aucune autre entrée. Le TAUX D'ÉPARGNE a été retiré : il mesurait un mérite là où le profil décrit
 * un état, et il valait 0 % pour quiconque épargne autrement que par virement interne — un artefact
 * de saisie promu au rang de critère.
 *
 * Ces cas verrouillent trois promesses : la cascade elle-même, sa MONOTONIE (chaque palier ajoute
 * une condition à celui d'en dessous), et le fait qu'aucun utilisateur ne soit classé sur des
 * données qu'on n'a pas.
 */

/** Situation de référence : revenu 2 000 €, charges 1 000 €, données complètes. */
const base: ProfileDataInputs = {
  availableSavings: 0,
  avgMonthlyIncome: 2000,
  monthlyEssentialExpenses: 1000,
  totalInvested: 0,
  hasRecurringExpenses: true,
};

/** Même situation, avec `n` mois de réserve (charges 1 000 € ⇒ n × 1 000 € d'épargne). */
const withMonths = (n: number, extra: Partial<ProfileDataInputs> = {}): ProfileDataInputs =>
  ({ ...base, availableSavings: n * 1000, ...extra });

describe('porte d’entrée — la CALCULABILITÉ, jamais la complétude', () => {
  it('sans revenu constaté → P0, quel que soit le reste', () => {
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0, availableSavings: 50000 })).toBe('P0');
  });

  /* ⚠️ LA COMPLÉTUDE NE BLOQUE PAS LE CLASSEMENT. Une version précédente exigeait un compte
     d'épargne ou une charge récurrente avant de classer : elle renvoyait en « Découverte » des
     comptes parfaitement installés — comptes saisis, revenus récurrents, enveloppe variable
     renseignée, c'est-à-dire exactement les trois choses que le démarrage impose.
     Ce que l'app ignore se DIT (fiabilité du profil), ça ne se traduit pas par un refus de classer. */
  it('un revenu suffit : ni compte d’épargne ni charge ne sont exigés pour classer', () => {
    expect(computeProfileFromData({
      ...base, hasRecurringExpenses: false, monthlyEssentialExpenses: 0,
    })).not.toBe('P0');
  });

  it('aucune épargne connue → P2, ce qui est vrai — et non P0', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 0 })).toBe('P2');
  });
});

describe('question 1 — la situation est-elle viable ?', () => {
  it('les charges dépassent le revenu → P1, sans avoir besoin d’un découvert', () => {
    expect(computeProfileFromData({
      ...base, avgMonthlyIncome: 1800, monthlyEssentialExpenses: 2100, checkingBalance: 300,
    })).toBe('P1');
  });

  it('à sec ET dans le rouge durablement → P1', () => {
    expect(computeProfileFromData({
      ...base, monthlyEssentialExpenses: 900, checkingBalance: -420, consecutiveOverdraftMonths: 2,
    })).toBe('P1');
  });

  it('un seul mois dans le rouge ne suffit pas', () => {
    expect(computeProfileFromData({
      ...base, monthlyEssentialExpenses: 900, checkingBalance: -420, consecutiveOverdraftMonths: 1,
    })).toBe('P2');
  });

  it('découvert PASSAGER avec de l’épargne mobilisable → jamais P1', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 900, checkingBalance: -200,
    })).not.toBe('P1');
  });

  /* LA DISPENSE. Consommer volontairement deux ans d'épargne — sabbatique, transition, création
     d'entreprise — n'est pas une fragilité. Sans elle, l'app servirait son diagnostic le plus dur à
     des gens qui maîtrisent parfaitement leur trajectoire. */
  it('une réserve profonde dispense de P1, même si les charges dépassent le revenu', () => {
    const sabbatique = { ...base, avgMonthlyIncome: 1000, monthlyEssentialExpenses: 2000 };
    expect(computeProfileFromData({ ...sabbatique, availableSavings: 4000 })).toBe('P1');   // 2 mois
    expect(computeProfileFromData({ ...sabbatique, availableSavings: 30000 })).toBe('P5');  // 15 mois
  });

  it('la viabilité a sa BANDE : entre les deux lectures, personne ne bouge', () => {
    // Charges à 98 % du revenu : ni assez au-dessus pour tomber, ni assez en dessous pour sortir.
    const limite = { ...base, avgMonthlyIncome: 2000, monthlyEssentialExpenses: 1960, availableSavings: 0 };
    expect(computeProfileFromData(limite, DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P1');
    expect(computeProfileFromData(limite, DEFAULT_PROFILE_THRESHOLDS, 'down')).toBe('P2');
    // Conséquence : ni un P1 ni un P2 ne change de palier dans cette zone.
    expect(resolveLiveProfile('P1', limite).changed).toBe(false);
    expect(resolveLiveProfile('P2', limite).changed).toBe(false);
  });
});

describe('question 2 — combien de temps tient-il ?', () => {
  it('moins d’un mois → P2', () => {
    expect(computeProfileFromData(withMonths(0.5))).toBe('P2');
  });

  it('1 à 3 mois → P3', () => {
    expect(computeProfileFromData(withMonths(1))).toBe('P3');
    expect(computeProfileFromData(withMonths(2.9))).toBe('P3');
  });

  it('3 à 6 mois → P4, sans aucune autre condition', () => {
    expect(computeProfileFromData(withMonths(3))).toBe('P4');
    expect(computeProfileFromData(withMonths(5.9))).toBe('P4');
  });

  it('≥ 6 mois, tout en liquide → P5', () => {
    expect(computeProfileFromData(withMonths(6))).toBe('P5');
    expect(computeProfileFromData(withMonths(24))).toBe('P5');
  });

  /* LE TAUX D'ÉPARGNE NE CLASSE PLUS RIEN. Deux personnes au même matelas sont au même palier,
     qu'elles épargnent par virement, par apport saisi à la main, ou pas du tout. */
  it('à matelas égal, le comportement d’épargne ne change plus le palier', () => {
    expect(computeProfileFromData(withMonths(2))).toBe(computeProfileFromData(withMonths(2)));
    expect(computeProfileFromData(withMonths(4))).toBe('P4');
    expect(computeProfileFromData(withMonths(1.2))).toBe('P3');
  });

  /* Le dénominateur, c'est ce qui SORT. Deux revenus identiques, deux trains de vie différents :
     ce sont bien deux situations distinctes. */
  it('le matelas se mesure sur les DÉPENSES, pas sur le revenu', () => {
    const sobre = { ...base, avgMonthlyIncome: 4000, monthlyEssentialExpenses: 1500, availableSavings: 12000 };
    const serre = { ...base, avgMonthlyIncome: 4000, monthlyEssentialExpenses: 3800, availableSavings: 12000 };
    // Même revenu, même épargne, deux trains de vie : 8 mois d'un côté, 3,2 de l'autre.
    expect(computeProfileFromData(sobre)).toBe('P5');
    expect(computeProfileFromData(serre)).toBe('P4');
  });

  /* SANS CHARGE SAISIE, LE DÉNOMINATEUR EST UN LEURRE. Les « dépenses essentielles » se réduisent
     alors à l'enveloppe variable : 3 000 € de côté et 400 €/mois de courses donneraient « 7,5 mois »
     — donc « Sécurité acquise » — alors qu'un loyer de 900 € est ignoré. On retombe sur le revenu,
     dénominateur prudent. */
  it('charges inconnues → le matelas se mesure sur le revenu, jamais sur des dépenses amputées', () => {
    const sansCharges = {
      ...base, hasRecurringExpenses: false,
      monthlyEssentialExpenses: 400,      // l'enveloppe variable seule
      availableSavings: 3000, avgMonthlyIncome: 2000,
    };
    // 3 000 ÷ 400 = 7,5 mois (faux) ; 3 000 ÷ 2 000 = 1,5 mois (prudent).
    expect(computeProfileFromData(sansCharges)).toBe('P3');
  });
});

describe('questions 3 et 4 — placements, puis taille du patrimoine', () => {
  it('≥ 6 mois ET de l’argent réellement placé → P6', () => {
    expect(computeProfileFromData(withMonths(6, { totalInvested: 5000 }))).toBe('P6');
  });

  it('30 000 € → P7, 100 000 € → P8, 300 000 € → P9', () => {
    expect(computeProfileFromData(withMonths(6, { totalInvested: 12000, totalLiquidWealth: 34000 }))).toBe('P7');
    expect(computeProfileFromData(withMonths(6, { totalInvested: 80000, totalLiquidWealth: 125000 }))).toBe('P8');
    expect(computeProfileFromData(withMonths(6, { totalInvested: 300000, totalLiquidWealth: 380000 }))).toBe('P9');
  });

  it('le million est NOMMÉ, il n’ouvre pas un onzième palier', () => {
    expect(isMillionaire(1_200_000)).toBe(true);
    expect(isMillionaire(940_000)).toBe(false);
    expect(computeProfileFromData(withMonths(6, { totalInvested: 900000, totalLiquidWealth: 1_500_000 }))).toBe('P9');
  });

  /* MONOTONIE DE L'ÉCHELLE. P7 exigeait trois mois de réserve quand P5 et P6 en demandent six : on
     pouvait donc atteindre un palier « supérieur » en étant MOINS couvert que deux paliers plus bas,
     et redescendre de P7 à P3 sans qu'aucune donnée n'ait bougé. */
  it('un patrimoine important n’ouvre rien tant que la réserve n’est pas pleine', () => {
    const riche = { totalInvested: 200000, totalLiquidWealth: 240000 };
    expect(computeProfileFromData(withMonths(4, riche))).toBe('P4');   // 4 mois : pas encore
    expect(computeProfileFromData(withMonths(6, riche))).toBe('P8');   // 6 mois : le palier s'ouvre
  });

  it('un capital qui DORT n’est pas un patrimoine piloté', () => {
    // 400 000 € sur un livret, rien de placé : on reste sur l'échelle du matelas.
    expect(computeProfileFromData({
      ...base, availableSavings: 400000, totalInvested: 0, totalLiquidWealth: 400000,
    })).toBe('P5');
  });

  it('patrimoine élevé mais AUCUNE liquidité → l’échelle du matelas reprend la main', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 0, totalInvested: 400000, totalLiquidWealth: 400000,
    })).toBe('P2');
  });
});

/**
 * L'ÉCHELLE EST UNE CHAÎNE DE CONDITIONS CUMULATIVES. C'est ce qui permet de l'expliquer en une
 * phrase — et ce qui garantit qu'on ne peut pas être « en avance » sur un axe et « en retard » sur
 * un autre dans le même palier.
 */
describe('monotonie — un palier supérieur n’est jamais moins exigeant', () => {
  it('la réserve exigée ne décroît jamais en montant l’échelle', () => {
    const { monthsUp, wealthMinMonths } = DEFAULT_PROFILE_THRESHOLDS;
    const required = [monthsUp.P3, monthsUp.P4, monthsUp.P5, monthsUp.P6,
      wealthMinMonths.P7, wealthMinMonths.P8, wealthMinMonths.P9];
    for (let i = 1; i < required.length; i++) {
      expect(required[i]).toBeGreaterThanOrEqual(required[i - 1]);
    }
  });

  it('un matelas qui grandit ne fait jamais RECULER le palier', () => {
    let previousRank = -1;
    for (const m of [0, 0.5, 1, 2, 3, 5, 6, 8, 12, 24]) {
      const rank = RANKED_PROFILE_IDS.indexOf(computeProfileFromData(withMonths(m)));
      expect(rank).toBeGreaterThanOrEqual(previousRank);
      previousRank = rank;
    }
  });

  it('le seuil de descente est toujours sous le seuil de montée', () => {
    const { monthsUp, monthsDown, wealthUp, wealthDown } = DEFAULT_PROFILE_THRESHOLDS;
    for (const k of ['P3', 'P4', 'P5', 'P6'] as const) {
      expect(monthsDown[k]).toBeLessThanOrEqual(monthsUp[k]);
    }
    for (const k of ['P7', 'P8', 'P9'] as const) {
      expect(wealthDown[k]).toBeLessThanOrEqual(wealthUp[k]);
    }
  });
});

/**
 * INVARIANTS DU RÉFÉRENTIEL. Ils tiennent en trois lignes et évitent la classe d'erreur la plus
 * coûteuse : une répartition qui ne fait pas 100 % distribue un Relyka faux à tout un palier, et
 * ça ne se voit qu'à l'euro près, sur un écran.
 */
describe('référentiel des profils — invariants', () => {
  it('chaque profil répartit exactement 100 % du Relyka', () => {
    for (const id of FINANCIAL_PROFILE_IDS) {
      const a = PROFILE_ALLOCATIONS[id];
      expect(`${id}:${a.save + a.invest + a.enjoy + a.keep}`).toBe(`${id}:100`);
    }
  });

  it('chaque profil a un libellé, un palier de vocabulaire et une allocation', () => {
    expect(FINANCIAL_PROFILE_IDS).toHaveLength(10);
    for (const id of FINANCIAL_PROFILE_IDS) {
      expect(PROFILE_INFO[id]?.name).toBeTruthy();
      expect(PROFILE_TO_TIER[id]).toBeTruthy();
      expect(PROFILE_ALLOCATIONS[id]).toBeTruthy();
    }
  });

  /* L'investissement ne doit jamais reculer quand on monte l'échelle, et l'épargne de précaution
     jamais progresser : c'est la promesse que la courbe raconte à l'utilisateur.
     DEUX EXCEPTIONS ASSUMÉES, hors de la comparaison :
       • P0 ne classe pas (absence de données) ;
       • P1 n'est pas viable — lui demander d'épargner plus qu'un P2 serait absurde, son argent doit
         d'abord rester disponible. La courbe d'épargne part donc de P2. */
  it('l’investissement croît et l’épargne de précaution décroît le long de l’échelle', () => {
    const ranked = FINANCIAL_PROFILE_IDS.filter((p) => p !== 'P0');
    for (let i = 1; i < ranked.length; i++) {
      expect(PROFILE_ALLOCATIONS[ranked[i]].invest).toBeGreaterThanOrEqual(PROFILE_ALLOCATIONS[ranked[i - 1]].invest);
    }
    const savingLadder = ranked.filter((p) => p !== 'P1');
    for (let i = 1; i < savingLadder.length; i++) {
      expect(PROFILE_ALLOCATIONS[savingLadder[i]].save).toBeLessThanOrEqual(PROFILE_ALLOCATIONS[savingLadder[i - 1]].save);
    }
  });

  it('les transitions couvrent tous les paliers voisins, dans l’ordre', () => {
    expect(PROFILE_TRANSITION_KEYS).toEqual([
      'P1_P2', 'P2_P3', 'P3_P4', 'P4_P5', 'P5_P6', 'P6_P7', 'P7_P8', 'P8_P9',
    ]);
  });
});

/**
 * UN IDENTIFIANT VENU DE LA BASE N'EST PAS UNE PROMESSE.
 *
 * Une migration s'applique à la base AVANT que la nouvelle version du code n'atteigne les appareils.
 * Un client encore sur l'ancien bundle lit donc un palier qu'il ne connaît pas — et toutes les
 * tables indexées par profil (PROFILE_INFO, PROFILE_ALLOCATIONS, DEFAULT_PULSE_SIGNALS…) rendaient
 * `undefined`. C'est ce qui a mis l'état des lieux à terre : `undefined.filter(...)`, chez tout le
 * monde en même temps, sur un simple renommage de paliers.
 */
describe('resolveProfileId — aucun identifiant inconnu ne peut casser un écran', () => {
  it('laisse passer les identifiants du référentiel', () => {
    for (const id of FINANCIAL_PROFILE_IDS) expect(resolveProfileId(id)).toBe(id);
  });

  it('ramène un palier PLUS RÉCENT que ce bundle sur le plus haut connu', () => {
    expect(resolveProfileId('P12')).toBe('P9');
    expect(resolveProfileId('P10')).toBe('P9');
  });

  it('ramène l’absence ou l’illisible sur « Découverte » — ce qu’elle signifie', () => {
    expect(resolveProfileId(null)).toBe('P0');
    expect(resolveProfileId(undefined)).toBe('P0');
    expect(resolveProfileId('')).toBe('P0');
    expect(resolveProfileId('inconnu')).toBe('P0');
    expect(resolveProfileId('P-3')).toBe('P0');
  });

  it('toute valeur résolue indexe bien les trois tables du référentiel', () => {
    for (const raw of ['P12', 'inconnu', null, 'P0', 'P9', 'p4']) {
      const id = resolveProfileId(raw as any);
      expect(PROFILE_INFO[id]).toBeTruthy();
      expect(PROFILE_ALLOCATIONS[id]).toBeTruthy();
      expect(PROFILE_TO_TIER[id]).toBeTruthy();
    }
  });
});

/**
 * PROFIL VIVANT — évalué en continu, mais qui ne clignote pas.
 *
 * La cadence mensuelle réglait le clignotement en sacrifiant la justesse : le profil restait faux
 * jusqu'au 1er du mois suivant. L'hystérésis règle le même problème sans ce prix — le seuil n'est
 * pas au même endroit selon le sens du trajet.
 */
describe('resolveLiveProfile — temps réel avec hystérésis', () => {
  it('rien ne bouge tant que la situation ne bouge pas', () => {
    const r = resolveLiveProfile('P3', withMonths(2));
    expect(r.changed).toBe(false);
    expect(r.profileId).toBe('P3');
  });

  /* La bande est ASYMÉTRIQUE : on monte dès que le but est atteint, on ne redescend que sur une
     vraie rechute. Reporter la bonne nouvelle au prétexte qu'elle est « tout juste acquise » serait
     mesquin — six mois de réserve, c'est six mois de réserve. */
  it('atteindre le seuil fait monter TOUT DE SUITE', () => {
    const r = resolveLiveProfile('P4', withMonths(6.05));
    expect(r.changed).toBe(true);
    expect(r.direction).toBe('up');
    expect(r.profileId).toBe('P5');
  });

  it('repasser sous le seuil de montée ne fait PAS redescendre', () => {
    expect(resolveLiveProfile('P5', withMonths(5.8)).changed).toBe(false);
    expect(resolveLiveProfile('P5', withMonths(3)).changed).toBe(false);
  });

  it('une vraie rechute fait redescendre', () => {
    const r = resolveLiveProfile('P5', withMonths(1.5));
    expect(r.changed).toBe(true);
    expect(r.direction).toBe('down');
  });

  it('osciller autour du seuil ne produit QU’UN SEUL changement', () => {
    let id: FinancialProfileId = 'P4';
    const changes: string[] = [];
    for (const m of [6.1, 5.9, 6.2, 5.8, 6.05]) {
      const r = resolveLiveProfile(id, withMonths(m));
      if (r.changed) changes.push(`${id}→${r.profileId}`);
      id = r.profileId;
    }
    expect(changes).toEqual(['P4→P5']);
    expect(id).toBe('P5');
  });

  it('compte le nombre de paliers franchis (pour choisir le bon message)', () => {
    const r = resolveLiveProfile('P2', withMonths(9, { totalInvested: 5000 }));
    expect(r.direction).toBe('up');
    expect(r.steps).toBeGreaterThan(1);
  });

  it('les seuils viennent de la CONFIGURATION, pas du code', () => {
    const strict = { ...DEFAULT_PROFILE_THRESHOLDS, monthsUp: { P3: 1, P4: 3, P5: 12, P6: 12 } };
    expect(resolveLiveProfile('P4', withMonths(7)).profileId).toBe('P5');
    expect(resolveLiveProfile('P4', withMonths(7), strict).changed).toBe(false);
  });

  it('quitter Découverte est immédiat : ce n’est pas un palier, c’est une absence de données', () => {
    const r = resolveLiveProfile('P0', withMonths(6.1));
    expect(r.changed).toBe(true);
    expect(r.profileId).toBe('P5');
  });
});

/**
 * LES SEUILS VIENNENT DE L'ADMINISTRATION.
 *
 * L'écran d'administration proposait de régler « Montée — mois de dépenses couverts ≥ » alors que
 * plus rien ne lisait ces valeurs : on croyait calibrer, le comportement ne bougeait pas. Ces cas
 * verrouillent le branchement — et surtout le repli champ par champ, qui permet de déployer la
 * configuration progressivement sans jamais casser le calcul.
 */
describe('thresholdsFromMatrix — la configuration gouverne, le code se contente de replier', () => {
  it('sans configuration, on retombe exactement sur les valeurs de repli', () => {
    expect(thresholdsFromMatrix(null)).toEqual(DEFAULT_PROFILE_THRESHOLDS);
    expect(thresholdsFromMatrix([])).toEqual(DEFAULT_PROFILE_THRESHOLDS);
  });

  it('lit les seuils de matelas, montée ET descente', () => {
    const t = thresholdsFromMatrix([
      { transition: 'P4_P5', upgrade_months_threshold: 9, downgrade_months_threshold: 4 },
    ]);
    expect(t.monthsUp.P5).toBe(9);
    expect(t.monthsDown.P5).toBe(4);
  });

  it('une ligne partielle ne fait pas tomber les autres champs', () => {
    const t = thresholdsFromMatrix([{ transition: 'P4_P5', upgrade_months_threshold: 9 }]);
    expect(t.monthsUp.P5).toBe(9);
    expect(t.monthsDown.P5).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsDown.P5);
    expect(t.monthsUp.P3).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsUp.P3);
  });

  it('lit les paliers de patrimoine et le découvert chronique', () => {
    const t = thresholdsFromMatrix([
      { transition: 'P6_P7', upgrade_wealth_threshold: 50000, downgrade_wealth_threshold: 40000, upgrade_months_threshold: 4 },
      { transition: 'P1_P2', chronic_overdraft_months: 3 },
    ]);
    expect(t.wealthUp.P7).toBe(50000);
    expect(t.wealthDown.P7).toBe(40000);
    expect(t.wealthMinMonths.P7).toBe(4);
    expect(t.chronicOverdraftMonths).toBe(3);
  });

  it('lit les réglages de VIABILITÉ, portés par la ligne P1_P2', () => {
    const t = thresholdsFromMatrix([{
      transition: 'P1_P2',
      viability_exit_ratio: 0.9, viability_enter_ratio: 1.1, viability_grace_months: 3,
    }]);
    expect(t.viabilityExitRatio).toBe(0.9);
    expect(t.viabilityEnterRatio).toBe(1.1);
    expect(t.viabilityGraceMonths).toBe(3);
  });

  it('une valeur illisible ne remplace jamais le repli par NaN', () => {
    const t = thresholdsFromMatrix([
      { transition: 'P4_P5', upgrade_months_threshold: null, downgrade_months_threshold: undefined },
    ]);
    expect(t.monthsUp.P5).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsUp.P5);
    expect(Number.isFinite(t.monthsDown.P5)).toBe(true);
  });
});
