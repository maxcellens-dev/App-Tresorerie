import {
  computeProfileFromData,
  PROFILE_ALLOCATIONS,
  PROFILE_INFO,
  PROFILE_TO_TIER,
  FINANCIAL_PROFILE_IDS,
  RANKED_PROFILE_IDS,
  PROFILE_TRANSITION_KEYS,
  resolveProfileId,
  resolveLiveProfile,
  DEFAULT_PROFILE_THRESHOLDS,
  thresholdsFromMatrix,
  allocationsFromRows,
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

  /* Le patrimoine se DÉDUIT : épargne + placements, et rien d'autre. Le solde courant en est exclu —
     c'est la trésorerie du mois, pas un patrimoine. L'inclure faisait entrer en « Patrimoine en
     construction » quelqu'un qui venait d'être payé, et l'en faisait ressortir trois semaines plus
     tard. (Ici : 6 mois de réserve × 1 000 € de dépenses = 6 000 € d'épargne, + les placements.) */
  it('30 000 € → P7, 100 000 € → P8, 300 000 € → P9', () => {
    expect(computeProfileFromData(withMonths(6, { totalInvested: 26000 }))).toBe('P7');
    expect(computeProfileFromData(withMonths(6, { totalInvested: 96000 }))).toBe('P8');
    expect(computeProfileFromData(withMonths(6, { totalInvested: 296000 }))).toBe('P9');
  });

  it('un gros solde COURANT n’ouvre aucun palier de patrimoine', () => {
    // 60 000 € sur le compte courant, réserve pleine, placements modestes : ce n'est pas un
    // patrimoine, c'est de la trésorerie. On reste sur l'échelle du matelas.
    expect(computeProfileFromData(withMonths(6, { totalInvested: 2000, checkingBalance: 60000 }))).toBe('P6');
  });

  /* Le million n'ouvre pas de onzième palier : il n'est qu'un mot dans la description de P9.
     (`isMillionaire` a été retiré — une fonction appelée par un seul test et par aucun écran.) */
  it('au-delà du million, on reste en P9', () => {
    expect(computeProfileFromData(withMonths(6, { totalInvested: 900000 }))).toBe('P9');
  });

  /* MONOTONIE DE L'ÉCHELLE. P7 exigeait trois mois de réserve quand P5 et P6 en demandent six : on
     pouvait donc atteindre un palier « supérieur » en étant MOINS couvert que deux paliers plus bas,
     et redescendre de P7 à P3 sans qu'aucune donnée n'ait bougé. */
  it('un patrimoine important n’ouvre rien tant que la réserve n’est pas pleine', () => {
    const riche = { totalInvested: 200000 };
    expect(computeProfileFromData(withMonths(4, riche))).toBe('P4');   // 4 mois : pas encore
    expect(computeProfileFromData(withMonths(6, riche))).toBe('P8');   // 6 mois : le palier s'ouvre
  });

  it('un capital qui DORT n’est pas un patrimoine piloté', () => {
    // 400 000 € sur un livret, rien de placé : on reste sur l'échelle du matelas.
    expect(computeProfileFromData({
      ...base, availableSavings: 400000, totalInvested: 0,
    })).toBe('P5');
  });

  it('patrimoine élevé mais AUCUNE liquidité → l’échelle du matelas reprend la main', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 0, totalInvested: 400000,
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

/**
 * LES POURCENTAGES DE RÉPARTITION VIENNENT DE L'ADMINISTRATION (migration 207).
 *
 * Ils décident de ce qu'on recommande de faire de l'argent, palier par palier : les régler ne
 * doit pas demander une livraison. Mais une table lue depuis la base peut être vide, partielle ou
 * incohérente — et une répartition qui ne fait pas 100 % distribue un Relyka faux à toute une
 * population, sans que rien ne le signale à l'écran.
 */
describe('allocationsFromRows — l’administration règle, le code garde le filet', () => {
  it('sans configuration, exactement les valeurs du code', () => {
    expect(allocationsFromRows(null)).toEqual(PROFILE_ALLOCATIONS);
    expect(allocationsFromRows([])).toEqual(PROFILE_ALLOCATIONS);
  });

  it('une ligne valable remplace SON palier, et lui seul', () => {
    const t = allocationsFromRows([
      { profile_id: 'P4', save_percent: 40, invest_percent: 10, enjoy_percent: 20, keep_percent: 30 },
    ]);
    expect(t.P4).toEqual({ save: 40, invest: 10, enjoy: 20, keep: 30 });
    expect(t.P5).toEqual(PROFILE_ALLOCATIONS.P5);
  });

  /* Le repli est PALIER PAR PALIER : une ligne cassée ne doit pas emporter les neuf autres, et
     surtout pas se substituer à une répartition juste. */
  it('une somme ≠ 100 est ignorée — on garde la valeur du code', () => {
    const t = allocationsFromRows([
      { profile_id: 'P4', save_percent: 40, invest_percent: 10, enjoy_percent: 20, keep_percent: 25 },
    ]);
    expect(t.P4).toEqual(PROFILE_ALLOCATIONS.P4);
  });

  it('une valeur manquante, négative ou illisible est ignorée', () => {
    const t = allocationsFromRows([
      { profile_id: 'P2', save_percent: 55, invest_percent: null, enjoy_percent: 10, keep_percent: 35 },
      { profile_id: 'P3', save_percent: -5, invest_percent: 40, enjoy_percent: 30, keep_percent: 35 },
    ]);
    expect(t.P2).toEqual(PROFILE_ALLOCATIONS.P2);
    expect(t.P3).toEqual(PROFILE_ALLOCATIONS.P3);
  });

  it('un palier inconnu n’entre jamais dans la table', () => {
    const t = allocationsFromRows([
      { profile_id: 'P42', save_percent: 25, invest_percent: 25, enjoy_percent: 25, keep_percent: 25 },
    ]);
    expect(Object.keys(t).sort()).toEqual([...FINANCIAL_PROFILE_IDS].sort());
  });

  it('la table rendue répartit toujours exactement 100 %', () => {
    const t = allocationsFromRows([
      { profile_id: 'P6', save_percent: 0, invest_percent: 70, enjoy_percent: 20, keep_percent: 10 },
      { profile_id: 'P7', save_percent: 1, invest_percent: 1, enjoy_percent: 1, keep_percent: 1 },
    ]);
    for (const id of FINANCIAL_PROFILE_IDS) {
      const a = t[id];
      expect(`${id}:${a.save + a.invest + a.enjoy + a.keep}`).toBe(`${id}:100`);
    }
  });
});

/* ── LE DERNIER SEUIL SANS HYSTÉRÉSIS ────────────────────────────────────────────────────────────
   La RÉSERVE exigée par les paliers de patrimoine (`wealthMinMonths`) servait à la fois à monter et
   à descendre : une même valeur, dans les deux sens. Chez quelqu'un dont le matelas frôle six mois —
   et il bouge à chaque saisie, puisque l'enveloppe de dépenses variables entre dans son
   dénominateur — le profil basculait P6 ⇄ P7 d'une opération à l'autre, avec une fenêtre « ton
   profil a changé » à chaque passage. C'est précisément ce contre quoi la bande existe. */
describe('paliers de patrimoine — la réserve exigée a sa bande, comme le reste', () => {
  /** Patrimoine confortable, placements en place : seul le matelas bouge. */
  const rich = (months: number): ProfileDataInputs => ({
    availableSavings: months * 1000,
    avgMonthlyIncome: 3000,
    monthlyEssentialExpenses: 1000,
    hasRecurringExpenses: true,
    checkingBalance: 2000,
    consecutiveOverdraftMonths: 0,
    totalInvested: 40000,
  });

  it('on monte en P7 à six mois de réserve', () => {
    expect(computeProfileFromData(rich(6.1), DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P7');
  });

  it('on NE redescend PAS de P7 pour un dixième de mois en moins', () => {
    const live = resolveLiveProfile('P7', rich(5.9), DEFAULT_PROFILE_THRESHOLDS);
    expect(live.profileId).toBe('P7');
    expect(live.changed).toBe(false);
  });

  it('un aller-retour autour de six mois ne produit AUCUN changement', () => {
    let current: FinancialProfileId = 'P7';
    for (const months of [5.95, 6.05, 5.9, 6.02, 5.98]) {
      const live = resolveLiveProfile(current, rich(months), DEFAULT_PROFILE_THRESHOLDS);
      expect(live.changed).toBe(false);
      current = live.profileId;
    }
    expect(current).toBe('P7');
  });

  it('une vraie rechute de réserve fait bien redescendre', () => {
    const live = resolveLiveProfile('P7', rich(4), DEFAULT_PROFILE_THRESHOLDS);
    expect(live.changed).toBe(true);
    expect(live.direction).toBe('down');
  });

  it('la bande de sortie est lue dans la configuration (colonne de descente)', () => {
    const cfg = thresholdsFromMatrix([
      { transition: 'P6_P7', upgrade_months_threshold: 6, downgrade_months_threshold: 3 },
    ] as any);
    expect(cfg.wealthMinMonths.P7).toBe(6);
    expect(cfg.wealthMinMonthsDown.P7).toBe(3);
  });

  it('colonne de descente vide → repli sur la bande par défaut, jamais sur le seuil de montée', () => {
    const cfg = thresholdsFromMatrix([{ transition: 'P6_P7', upgrade_months_threshold: 8 }] as any);
    expect(cfg.wealthMinMonths.P7).toBe(8);
    expect(cfg.wealthMinMonthsDown.P7).toBe(DEFAULT_PROFILE_THRESHOLDS.wealthMinMonthsDown.P7);
  });
});

/* ── LA DISPENSE DE « FRAGILE » A SA BANDE, ELLE AUSSI ───────────────────────────────────────────
   Quelqu'un en déficit qui vit sur son épargne voit son matelas bouger à chaque saisie : l'enveloppe
   de dépenses variables est à son dénominateur. Avec un seuil unique, il basculait « Fragile » ⇄
   « Sécurité acquise » à 5,95 puis 6,05 mois — quatre paliers d'un coup, dans les deux sens, avec
   une fenêtre à chaque passage. C'est le diagnostic le plus dur de l'app : il ne peut pas clignoter. */
describe('dispense de viabilité — bande d’hystérésis', () => {
  /** Déficit structurel (charges > revenu), matelas piloté par le test. */
  const burning = (months: number): ProfileDataInputs => ({
    availableSavings: months * 2000,
    avgMonthlyIncome: 1500,
    monthlyEssentialExpenses: 2000,   // 2 000 > 1 500 × 1,02 → déficit dans les deux lectures
    hasRecurringExpenses: true,
    checkingBalance: 500,
    consecutiveOverdraftMonths: 0,
    totalInvested: 0,
  });

  it('sous la dispense, la non-viabilité domine → Fragile', () => {
    expect(computeProfileFromData(burning(3), DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P1');
  });

  it('une réserve profonde dispense de Fragile', () => {
    expect(computeProfileFromData(burning(8), DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P5');
  });

  it('un aller-retour autour de six mois ne fait plus clignoter « Fragile »', () => {
    let current: FinancialProfileId = 'P5';
    for (const months of [5.95, 6.05, 5.9, 6.02]) {
      const live = resolveLiveProfile(current, burning(months), DEFAULT_PROFILE_THRESHOLDS);
      expect(live.changed).toBe(false);
      current = live.profileId;
    }
    expect(current).toBe('P5');
  });

  it('une vraie fonte de la réserve fait bien basculer en Fragile', () => {
    const live = resolveLiveProfile('P5', burning(4), DEFAULT_PROFILE_THRESHOLDS);
    expect(live.changed).toBe(true);
    expect(live.profileId).toBe('P1');
  });

  it('la bande de sortie est lue dans la configuration (ligne P1_P2)', () => {
    const cfg = thresholdsFromMatrix([
      { transition: 'P1_P2', viability_grace_months: 6, downgrade_months_threshold: 2 },
    ] as any);
    expect(cfg.viabilityGraceMonths).toBe(6);
    expect(cfg.viabilityGraceMonthsDown).toBe(2);
  });

  /* ⚠️ LE CAS QUI MANQUAIT, ET QUI A LAISSÉ PASSER SIX MOIS DE BUG.
     Tous les cas ci-dessus tournent sur `DEFAULT_PROFILE_THRESHOLDS`, où la bande vaut 6 / 5. La
     BASE, elle, portait 6 / 0,5 : la migration 209 devait y semer 5 mais se gardait par `IS NULL`,
     alors que la 020 y avait laissé 0,5. Le repli était juste, la configuration était fausse, et
     rien ne les comparait — donc tout était vert pendant qu'en production « Fragile » n'arrivait
     plus qu'au dernier euro. Ce cas lit la configuration RÉELLE (cf. PROD_MATRIX). */
  it('avec la configuration RÉELLE, une fonte de réserve fait bien basculer en Fragile', () => {
    const cfg = thresholdsFromMatrix(PROD_MATRIX);
    expect(cfg.viabilityGraceMonthsDown).toBe(5);
    const live = resolveLiveProfile('P5', burning(4), cfg);
    expect(live.changed).toBe(true);
    expect(live.profileId).toBe('P1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   LA CONFIGURATION RÉELLEMENT DÉPLOYÉE
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Le moteur ne tourne JAMAIS sur `DEFAULT_PROFILE_THRESHOLDS` en production : il lit
   `profile_matrix_config`. Tester le seul repli revient à valider un code que personne n'exécute —
   c'est exactement ce qui a permis à la bande de « Fragile » de rester fausse en base (6 / 0,5 au
   lieu de 6 / 5) pendant que tous les cas passaient au vert.

   Ces lignes reproduisent la table telle que la chaîne de migrations la laisse (020 → 182 → 194 →
   206 → 209 → 216). À maintenir avec elle : si une migration change un seuil, ce bloc change AVEC,
   et l'écart entre les deux mondes redevient visible immédiatement. */
const PROD_MATRIX = [
  { transition: 'P1_P2', upgrade_months_threshold: null, downgrade_months_threshold: 5,
    chronic_overdraft_months: 2,
    viability_exit_ratio: 0.95, viability_enter_ratio: 1.02, viability_grace_months: 6 },
  { transition: 'P2_P3', upgrade_months_threshold: 1, downgrade_months_threshold: 0.5 },
  { transition: 'P3_P4', upgrade_months_threshold: 3, downgrade_months_threshold: 1 },
  { transition: 'P4_P5', upgrade_months_threshold: 6, downgrade_months_threshold: 2.5 },
  { transition: 'P5_P6', upgrade_months_threshold: 6, downgrade_months_threshold: 5,
    upgrade_wealth_threshold: 500, downgrade_wealth_threshold: 250 },
  { transition: 'P6_P7', upgrade_months_threshold: 6, downgrade_months_threshold: 5,
    upgrade_wealth_threshold: 30_000, downgrade_wealth_threshold: 24_000,
    invested_share_up: 0.10, invested_share_down: 0.05 },
  { transition: 'P7_P8', upgrade_months_threshold: 6, downgrade_months_threshold: 5,
    upgrade_wealth_threshold: 100_000, downgrade_wealth_threshold: 85_000 },
  { transition: 'P8_P9', upgrade_months_threshold: 6, downgrade_months_threshold: 5,
    upgrade_wealth_threshold: 300_000, downgrade_wealth_threshold: 260_000 },
] as any;

describe('configuration déployée — elle doit dire la même chose que le repli du code', () => {
  /* Le repli sert hors-ligne et au démarrage à froid. S'il diverge de la base, le même utilisateur
     est classé différemment selon qu'il a du réseau — sans que rien ne le lui dise. */
  it('la matrice de production produit EXACTEMENT les seuils de repli', () => {
    expect(thresholdsFromMatrix(PROD_MATRIX)).toEqual(DEFAULT_PROFILE_THRESHOLDS);
  });

  it('aucune bande n’est inversée (descente toujours ≤ montée)', () => {
    const t = thresholdsFromMatrix(PROD_MATRIX);
    for (const k of ['P3', 'P4', 'P5', 'P6'] as const) {
      expect(t.monthsDown[k]).toBeLessThanOrEqual(t.monthsUp[k]);
    }
    for (const k of ['P7', 'P8', 'P9'] as const) {
      expect(t.wealthDown[k]).toBeLessThanOrEqual(t.wealthUp[k]);
      expect(t.wealthMinMonthsDown[k]).toBeLessThanOrEqual(t.wealthMinMonths[k]);
    }
    expect(t.viabilityGraceMonthsDown).toBeLessThanOrEqual(t.viabilityGraceMonths);
    expect(t.investedMinDown).toBeLessThanOrEqual(t.investedMinUp);
    expect(t.wealthInvestedShareDown).toBeLessThanOrEqual(t.wealthInvestedShareUp);
  });
});

/* ── « INVESTIR » N'EST PLUS UN BOOLÉEN À UN EURO ────────────────────────────────────────────────
   C'était la seule falaise de l'échelle : avec six mois de réserve et 100 000 € sur un livret, UN
   EURO posé sur un compte d'investissement faisait passer de P5 à P8 — trois paliers, et une
   répartition du Relyka qui bascule de « Épargner 50 % » à « Investir 70 % ». */
describe('placements — un montant qui compte, et une part du patrimoine', () => {
  /** Six mois de réserve (6 000 €), patrimoine dormant piloté par le test. */
  const withInvested = (savings: number, invested: number): ProfileDataInputs => ({
    ...base, availableSavings: savings, totalInvested: invested,
  });

  it('un euro symbolique n’ouvre plus rien', () => {
    expect(computeProfileFromData(withInvested(100_000, 1))).toBe('P5');
  });

  it('un premier versement qui compte ouvre P6', () => {
    expect(computeProfileFromData(withInvested(6_000, 500))).toBe('P6');
  });

  it('le seuil suit le sens du trajet (bande) : on ne perd pas P6 pour une baisse de marché', () => {
    // 300 € placés : sous le seuil d'entrée (500), au-dessus de celui de maintien (250).
    expect(computeProfileFromData(withInvested(6_000, 300), DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P5');
    expect(computeProfileFromData(withInvested(6_000, 300), DEFAULT_PROFILE_THRESHOLDS, 'down')).toBe('P6');
    expect(resolveLiveProfile('P6', withInvested(6_000, 300)).changed).toBe(false);
  });

  /* Les paliers de patrimoine prétendent décrire un patrimoine PILOTÉ. Un jeton posé sur un capital
     qui dort n'est pas ça — et les conseils d'optimisation qui vont avec tomberaient à côté. */
  it('un jeton sur un capital qui dort n’ouvre pas les paliers de patrimoine', () => {
    // 100 000 € dormants, 600 € placés (0,6 % du patrimoine) : investisseur, mais pas « piloté ».
    expect(computeProfileFromData(withInvested(100_000, 600))).toBe('P6');
  });

  it('une part réelle du patrimoine ouvre le palier', () => {
    // 15 000 € placés sur 115 000 € = 13 % ≥ 10 % → le patrimoine est piloté.
    expect(computeProfileFromData(withInvested(100_000, 15_000))).toBe('P8');
  });

  it('la part exigée a sa bande, comme le reste', () => {
    // 8 % du patrimoine : sous les 10 % d'entrée, au-dessus des 5 % de maintien.
    const entreDeux = withInvested(100_000, 8_700);
    expect(computeProfileFromData(entreDeux, DEFAULT_PROFILE_THRESHOLDS, 'up')).toBe('P6');
    expect(computeProfileFromData(entreDeux, DEFAULT_PROFILE_THRESHOLDS, 'down')).toBe('P8');
    expect(resolveLiveProfile('P8', entreDeux).changed).toBe(false);
  });

  it('à 0, la part n’est pas exigée (réglage neutralisable)', () => {
    const sansPart = { ...DEFAULT_PROFILE_THRESHOLDS, wealthInvestedShareUp: 0, wealthInvestedShareDown: 0 };
    expect(computeProfileFromData(withInvested(100_000, 600), sansPart)).toBe('P8');
  });
});

/* ── LE MÊME CHIFFRE NE PEUT PAS ÊTRE TROP INCERTAIN POUR DIVISER ET ASSEZ SÛR POUR CONDAMNER ────
   Sans charge récurrente saisie, les « dépenses essentielles » se réduisent à l'enveloppe variable :
   `computeSecurityCushion` refuse alors de diviser par elles. Le test de viabilité, lui, s'en
   servait quand même — une enveloppe variable déclarée un peu haute suffisait donc à servir le
   diagnostic le plus dur de l'app à quelqu'un dont l'app ignore encore le loyer. */
describe('viabilité — le même garde que le matelas sur les charges inconnues', () => {
  it('sans charge saisie, une enveloppe variable élevée ne déclare plus « Fragile »', () => {
    const sansCharges: ProfileDataInputs = {
      availableSavings: 0,
      avgMonthlyIncome: 1500,
      monthlyEssentialExpenses: 1600,   // l'enveloppe variable SEULE, loyer inconnu
      hasRecurringExpenses: false,
      totalInvested: 0,
      checkingBalance: 200,
    };
    expect(computeProfileFromData(sansCharges)).toBe('P2');
  });

  it('les mêmes chiffres, charges saisies : le diagnostic tombe, et il est fondé', () => {
    const avecCharges: ProfileDataInputs = {
      availableSavings: 0,
      avgMonthlyIncome: 1500,
      monthlyEssentialExpenses: 1600,
      hasRecurringExpenses: true,
      totalInvested: 0,
      checkingBalance: 200,
    };
    expect(computeProfileFromData(avecCharges)).toBe('P1');
  });

  /* Le second motif de P1 (à sec ET dans le rouge durablement) ne dépend pas des charges : il se
     lit sur les soldes. Il doit continuer de fonctionner sans aucune charge saisie. */
  it('à sec et dans le rouge durablement : P1 même sans charge connue', () => {
    expect(computeProfileFromData({
      ...base, hasRecurringExpenses: false, monthlyEssentialExpenses: 0,
      availableSavings: 0, checkingBalance: -420, consecutiveOverdraftMonths: 2,
    })).toBe('P1');
  });
});
