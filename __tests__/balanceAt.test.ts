import { balanceAtDate, laterVerification } from '../lib/finance/balanceAt';

/**
 * REMONTER LE TEMPS SUR UN SOLDE — le calcul dont dépendent tous les écarts écrits en base.
 *
 * Le solde stocké suit un modèle d'ANCRE : on part de la dernière régularisation qui porte un solde
 * cible, et on ajoute ce qui s'est passé après. Le client, lui, remontait le temps par soustraction
 * naïve (« solde d'aujourd'hui moins ce qui est arrivé depuis »), formule qui n'est exacte QUE s'il
 * n'y a aucune ancre dans l'intervalle. Or il y en a une à chaque « Mettre à jour mon solde ».
 *
 * Conséquence concrète : le solde de fin de mois proposé à la clôture était faux, donc l'écart
 * calculé aussi, donc la régularisation ÉCRITE EN BASE. Ces tests fixent la règle des deux côtés.
 */
const NOW = new Date(2026, 7, 19, 12, 0, 0); // 19 août 2026

const tx = (over: Partial<any> = {}): any => ({
  id: Math.random().toString(36).slice(2),
  account_id: 'acc-1', date: '2026-08-10', amount: -100,
  created_at: '2026-08-10T10:00:00Z',
  is_draft: false, is_recurring: false, regul_target: null, regul_covered: false,
  ...over,
});

/** Une régularisation ancrée : « à cette date, le compte valait exactement `target` ». */
const anchor = (date: string, target: number, over: Partial<any> = {}): any =>
  tx({ date, amount: 0, regul_target: target, note: 'Régularisation solde', created_at: `${date}T09:00:00Z`, ...over });

describe('balanceAtDate — sans aucune ancre', () => {
  it('remonte le temps depuis le solde d’aujourd’hui', () => {
    const all = [tx({ date: '2026-08-05', amount: -200 }), tx({ date: '2026-08-15', amount: -50 })];
    // Solde 1000 aujourd'hui ; au 10 août, les −50 du 15 n'étaient pas encore passés.
    expect(balanceAtDate(all, 'acc-1', 1000, '2026-08-10', NOW)).toBe(1050);
  });

  it('ignore les brouillons et les MODÈLES récurrents (occurrences projetées)', () => {
    const all = [tx({ date: '2026-08-15', amount: -500, is_draft: true }), tx({ date: '2026-08-15', amount: -500, is_recurring: true })];
    expect(balanceAtDate(all, 'acc-1', 1000, '2026-08-10', NOW)).toBe(1000);
  });

  it('ne mélange pas les comptes', () => {
    expect(balanceAtDate([tx({ account_id: 'acc-2', amount: -500, date: '2026-08-15' })], 'acc-1', 1000, '2026-08-10', NOW)).toBe(1000);
  });
});

/**
 * LE BUG. Une ancre absorbe tout ce qui la précède : ces opérations ne sont PLUS dans le solde. La
 * soustraction naïve les retirait pourtant une seconde fois.
 */
describe('balanceAtDate — avec une ancre, la soustraction naïve ne marche plus', () => {
  const all = [
    tx({ date: '2026-07-20', amount: -300 }),   // avant l'ancre → absorbée, invisible dans le solde
    anchor('2026-08-05', 1000),                 // « le 5 août, j'avais 1000 »
    tx({ date: '2026-08-12', amount: -150 }),   // après l'ancre → compte
  ];

  it('repart de la dernière ancre ANTÉRIEURE, sans jamais recompter le passé absorbé', () => {
    // Au 10 août : 1000, la dépense du 12 n'est pas encore passée. Le −300 de juillet est absorbé.
    expect(balanceAtDate(all, 'acc-1', 850, '2026-08-10', NOW)).toBe(1000);
    // Au 15 août : 1000 − 150.
    expect(balanceAtDate(all, 'acc-1', 850, '2026-08-15', NOW)).toBe(850);
    // Au jour même de l'ancre : sa cible, exactement.
    expect(balanceAtDate(all, 'acc-1', 850, '2026-08-05', NOW)).toBe(1000);
  });

  /* C'EST LE CAS QUI FAUSSAIT LA CLÔTURE : on clôture juillet, et une vérification existe en août.
     La formule naïve rendait 850 − (−300 −150) = 1300. La vraie réponse remonte depuis l'ancre. */
  it('avant l’ancre, on remonte le temps DEPUIS elle (et pas depuis aujourd’hui)', () => {
    // Au 31 juillet : l'ancre dit 1000 le 5 août ; rien entre les deux → 1000.
    expect(balanceAtDate(all, 'acc-1', 850, '2026-07-31', NOW)).toBe(1000);
    // Au 19 juillet : il faut retirer la dépense du 20 juillet, qui est bien entre les deux.
    expect(balanceAtDate(all, 'acc-1', 850, '2026-07-19', NOW)).toBe(1300);
  });

  it('une régularisation SANS cible n’ancre rien : c’est une opération ordinaire', () => {
    // Les écarts de clôture au prorata sont dans ce cas (montant, pas de solde cible).
    const withDelta = [tx({ date: '2026-08-05', amount: -80, note: 'Régularisation clôture (mois)' })];
    expect(balanceAtDate(withDelta, 'acc-1', 920, '2026-08-01', NOW)).toBe(1000);
  });

  it('à date d’ancre égale, une opération saisie AVANT elle est absorbée ; après elle, elle compte', () => {
    const sameDay = [
      anchor('2026-08-05', 1000),
      tx({ date: '2026-08-05', amount: -40, created_at: '2026-08-05T08:00:00Z' }), // avant l'ancre
      tx({ date: '2026-08-05', amount: -60, created_at: '2026-08-05T11:00:00Z' }), // après l'ancre
    ];
    expect(balanceAtDate(sameDay, 'acc-1', 940, '2026-08-05', NOW)).toBe(940);
  });

  it('« déjà comprise dans ce solde » (regul_covered) n’est jamais recomptée', () => {
    const covered = [
      anchor('2026-08-05', 1000),
      tx({ date: '2026-08-05', amount: -60, created_at: '2026-08-05T11:00:00Z', regul_covered: true }),
    ];
    expect(balanceAtDate(covered, 'acc-1', 1000, '2026-08-05', NOW)).toBe(1000);
  });

  /* REPRODUCTIBILITÉ : c'est ce qui manquait à la clôture. Le chiffre proposé ne doit dépendre que
     des faits antérieurs — sinon rouvrir un mois puis le reclôturer propose autre chose. */
  it('le résultat ne dépend PAS des opérations saisies après la date demandée', () => {
    const avant = balanceAtDate(all, 'acc-1', 850, '2026-08-10', NOW);
    const apres = balanceAtDate([...all, tx({ date: '2026-08-18', amount: -999 })], 'acc-1', -149, '2026-08-10', NOW);
    expect(apres).toBe(avant);
  });
});

/**
 * DIRE POURQUOI LE SOLDE NE BOUGE PAS. Corriger le 31 juillet alors qu'on a déjà confirmé son solde
 * le 5 août ne peut rien déplacer : l'écart est déjà compris dans la vérification du 5. C'est juste,
 * mais invisible — on validait, rien ne bougeait, et on concluait que la clôture était cassée.
 */
describe('laterVerification — une vérification plus récente prime', () => {
  const all = [anchor('2026-08-05', 1000)];

  it('signale la vérification postérieure la plus récente', () => {
    expect(laterVerification(all, 'acc-1', '2026-07-31')).toEqual({ date: '2026-08-05' });
  });

  it('ne signale rien quand la correction est bien la plus récente', () => {
    expect(laterVerification(all, 'acc-1', '2026-08-10')).toBeNull();
    expect(laterVerification(all, 'acc-1', '2026-08-05')).toBeNull();
  });

  it('ne regarde que le compte concerné', () => {
    expect(laterVerification(all, 'acc-2', '2026-07-31')).toBeNull();
  });
});
