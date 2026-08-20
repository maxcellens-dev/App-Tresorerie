import {
  computeProfileFromData,
  PROFILE_ALLOCATIONS,
  PROFILE_INFO,
  PROFILE_TO_TIER,
  FINANCIAL_PROFILE_IDS,
  PROFILE_TRANSITION_KEYS,
  isMillionaire,
  resolveProfileId,
  resolveLiveProfile,
  DEFAULT_PROFILE_THRESHOLDS,
  thresholdsFromMatrix,
} from '../lib/finance/financialProfileEngine';
import type { FinancialProfileId } from '../types/database';

/**
 * Le profil P0–P9 ne dépend d'AUCUNE réponse déclarée : il se déduit du revenu constaté, de
 * l'épargne, de ce qui est mis de côté chaque mois, de ce qui est réellement placé — et, pour les
 * paliers hauts, du patrimoine présent sur les comptes suivis.
 *
 * DEUX AXES, DEUX RÉGIMES :
 *   • P1 → P6 : le MATELAS DE SÉCURITÉ (épargne ÷ revenu mensuel) ;
 *   • P7 → P9 : le PATRIMOINE BANCAIRE, parce qu'au-delà d'un certain montant « combien de mois
 *     tiendrais-tu ? » ne distingue plus personne (400 000 € font 200 mois, comme 800 000 €).
 * P0 n'est pas un jugement : c'est l'absence de données.
 */
const base = { availableSavings: 0, avgMonthlyIncome: 2000, monthlySetAside: 0, totalInvested: 0 };

describe('computeProfileFromData — le profil se déduit des données réelles', () => {
  /* AVANT : un compte sans revenu constaté était classé « épargne critique » — un DIAGNOSTIC servi
     à quelqu'un dont on ne savait rien. P0 dit ce qui est vrai, et il est neutre. */
  it('sans revenu constaté → P0 « Découverte », quel que soit le reste', () => {
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0, availableSavings: 50000 })).toBe('P0');
    expect(computeProfileFromData({ ...base, avgMonthlyIncome: 0 })).toBe('P0');
  });

  it('compte neuf avec un revenu, mais rien de côté → P2 (sans découvert, ce n’est pas un déficit)', () => {
    expect(computeProfileFromData(base)).toBe('P2');
  });

  /* ── P1 = DÉFICIT, PAS DÉCOUVERT ────────────────────────────────────────────────────────────
     Un solde négatif un jour donné ne dit presque rien : on attend une paie, on a laissé filer le
     courant en gardant son livret, on vient de payer ses impôts. Classer là-dessus revient à
     confondre une photo avec une trajectoire. P1 exige donc une impasse : soit les charges
     dépassent le revenu, soit il ne reste PLUS RIEN nulle part. */
  it('à sec et dans le rouge, sans aucune épargne → P1', () => {
    expect(computeProfileFromData({ ...base, checkingBalance: -420 })).toBe('P1');
  });

  it('les charges dépassent le revenu → P1, même sans découvert', () => {
    expect(computeProfileFromData({
      ...base, avgMonthlyIncome: 1800, monthlyEssentialExpenses: 2100, checkingBalance: 300,
    })).toBe('P1');
  });

  it('découvert PASSAGER avec de l’épargne mobilisable → jamais P1', () => {
    // 900 € de côté et −200 € sur le courant : c'est un arbitrage de trésorerie, pas une impasse.
    expect(computeProfileFromData({ ...base, availableSavings: 900, checkingBalance: -200 })).not.toBe('P1');
  });

  it('un seul mois dans le rouge ne suffit pas quand on sait que ça ne dure pas', () => {
    expect(computeProfileFromData({
      ...base, checkingBalance: -420, consecutiveOverdraftMonths: 1,
    })).toBe('P2');
    expect(computeProfileFromData({
      ...base, checkingBalance: -420, consecutiveOverdraftMonths: 2,
    })).toBe('P1');
  });

  it('le rouge ne l’emporte PAS sur une réserve constituée : c’est le dernier recours', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000, checkingBalance: -200 })).toBe('P3');
  });

  it('moins d’un mois mais ≥ 10 % mis de côté → P2', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 1000, monthlySetAside: 250 })).toBe('P2');
  });

  it('1 à 3 mois de sécurité → P3 « Réserve à construire »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000 })).toBe('P3');
  });

  it('1 à 3 mois avec un fort taux d’épargne (≥ 20 %) → P4', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 4000, monthlySetAside: 450 })).toBe('P4');
  });

  it('3 à 6 mois et il met de côté → P4 « Équilibre trouvé »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 8000, monthlySetAside: 100 })).toBe('P4');
  });

  it('plus de 6 mois, tout en liquide → P5 « Sécurité acquise »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000 })).toBe('P5');
  });

  it('plus de 6 mois ET de l’argent réellement placé → P6 « Premiers placements »', () => {
    expect(computeProfileFromData({ ...base, availableSavings: 20000, totalInvested: 5000 })).toBe('P6');
  });

  // ── Paliers de patrimoine ───────────────────────────────────────────────────────────────────
  it('30 000 € sur les comptes, avec des placements → P7', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 20000, totalInvested: 12000, totalLiquidWealth: 34000,
    })).toBe('P7');
  });

  it('100 000 € → P8, 300 000 € → P9, et le million est NOMMÉ comme tel', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 40000, totalInvested: 80000, totalLiquidWealth: 125000,
    })).toBe('P8');
    expect(computeProfileFromData({
      ...base, availableSavings: 60000, totalInvested: 300000, totalLiquidWealth: 380000,
    })).toBe('P9');
    expect(isMillionaire(1_200_000)).toBe(true);
    expect(isMillionaire(940_000)).toBe(false);
  });

  /* Garde-fou : un gros patrimoine SANS liquidité (tout investi, rien de mobilisable) n'est pas un
     profil « patrimoine ». On redescend sur l'échelle du matelas — c'est précisément le conseil
     dont cette personne a besoin. */
  it('patrimoine élevé mais aucune réserve disponible → on retombe sur l’échelle du matelas', () => {
    expect(computeProfileFromData({
      ...base, availableSavings: 0, totalInvested: 400000, totalLiquidWealth: 400000,
    })).toBe('P2');
  });

  it('le profil apparaît dès que la donnée manquante arrive (revenu renseigné)', () => {
    const sansRevenu = { availableSavings: 8000, avgMonthlyIncome: 0, monthlySetAside: 300, totalInvested: 0 };
    expect(computeProfileFromData(sansRevenu)).toBe('P0');
    // Même compte, une fois le revenu constaté : 8 000 ÷ 2 000 = 4 mois, 300 €/mois (15 %) → P4.
    expect(computeProfileFromData({ ...sansRevenu, avgMonthlyIncome: 2000 })).toBe('P4');
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
       • P1 est déficitaire — lui demander d'épargner plus qu'un P2 serait absurde, son argent doit
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
  const withCushion = (months: number) => ({
    ...base, avgMonthlyIncome: 2000, monthlyEssentialExpenses: 1000,
    availableSavings: months * 1000,
  });

  it('rien ne bouge tant que la situation ne bouge pas', () => {
    const r = resolveLiveProfile('P3', withCushion(2));
    expect(r.changed).toBe(false);
    expect(r.profileId).toBe('P3');
  });

  /* La bande est ASYMÉTRIQUE : on monte dès que le but est atteint, on ne redescend que sur une
     vraie rechute. Reporter la bonne nouvelle au prétexte qu'elle est « tout juste acquise » serait
     mesquin — six mois de réserve, c'est six mois de réserve. */
  it('atteindre le seuil fait monter TOUT DE SUITE', () => {
    const r = resolveLiveProfile('P4', withCushion(6.05));
    expect(r.changed).toBe(true);
    expect(r.direction).toBe('up');
    expect(r.profileId).toBe('P5');
  });

  it('repasser sous le seuil de montée ne fait PAS redescendre', () => {
    // 5,8 mois : sous les 6 mois de P5, mais bien au-dessus du seuil de sortie (2,5).
    expect(resolveLiveProfile('P5', withCushion(5.8)).changed).toBe(false);
    expect(resolveLiveProfile('P5', withCushion(3)).changed).toBe(false);
  });

  it('une vraie rechute fait redescendre', () => {
    const r = resolveLiveProfile('P5', withCushion(1.5));
    expect(r.changed).toBe(true);
    expect(r.direction).toBe('down');
  });

  it('osciller autour du seuil ne produit QU’UN SEUL changement', () => {
    let id: FinancialProfileId = 'P4';
    const changes: string[] = [];
    for (const m of [6.1, 5.9, 6.2, 5.8, 6.05]) {
      const r = resolveLiveProfile(id, withCushion(m));
      if (r.changed) changes.push(`${id}→${r.profileId}`);
      id = r.profileId;
    }
    // Une montée à la première mesure, puis plus rien : aucun clignotement.
    expect(changes).toEqual(['P4→P5']);
    expect(id).toBe('P5');
  });

  it('compte le nombre de paliers franchis (pour choisir le bon message)', () => {
    const r = resolveLiveProfile('P2', {
      ...withCushion(9), totalInvested: 5000, monthlySetAside: 400,
    });
    expect(r.direction).toBe('up');
    expect(r.steps).toBeGreaterThan(1);
  });

  it('les seuils viennent de la CONFIGURATION, pas du code', () => {
    // Même situation, deux réglages : le palier obtenu doit suivre le réglage.
    const strict = { ...DEFAULT_PROFILE_THRESHOLDS, monthsUp: { P3: 1, P4: 3, P5: 12, P6: 12 } };
    expect(resolveLiveProfile('P4', withCushion(7)).profileId).toBe('P5');
    expect(resolveLiveProfile('P4', withCushion(7), strict).changed).toBe(false);
  });

  it('quitter Découverte est immédiat : ce n’est pas un palier, c’est une absence de données', () => {
    const r = resolveLiveProfile('P0', withCushion(6.1));
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
    // Les champs absents gardent leur repli — pas de zéro surgi de nulle part.
    expect(t.monthsDown.P5).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsDown.P5);
    expect(t.monthsUp.P3).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsUp.P3);
    expect(t.rateHigh).toBe(DEFAULT_PROFILE_THRESHOLDS.rateHigh);
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

  it('une valeur illisible ne remplace jamais le repli par NaN', () => {
    const t = thresholdsFromMatrix([
      { transition: 'P4_P5', upgrade_months_threshold: null, downgrade_months_threshold: undefined },
    ]);
    expect(t.monthsUp.P5).toBe(DEFAULT_PROFILE_THRESHOLDS.monthsUp.P5);
    expect(Number.isFinite(t.monthsDown.P5)).toBe(true);
  });
});
