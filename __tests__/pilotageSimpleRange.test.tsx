import { renderWithProviders, screen, within } from './utils/renderWithProviders';
import PilotageSimple from '../components/pilotage/PilotageSimple';

/**
 * CE QUE LA CARTE « TON RELYKA » AFFIRME QUAND ELLE N'EST PAS SÛRE D'ELLE.
 *
 * Trois affirmations se croisent sur cette carte : le chiffre principal, la fourchette juste en
 * dessous, et le geste proposé sur chaque décision. Aucune ne doit contredire les autres — et c'est
 * exactement ce qui arrivait :
 *
 *  • « minimum sûr 0 € » s'affichait sous un montant non nul, ce qui laisse croire qu'il ne reste
 *    peut-être rien ;
 *  • la tuile annonçait « Épargner 400 € » et le virement s'ouvrait pré-rempli à 240 € ;
 *  • le badge disait « Vérifié il y a un moment » à quelqu'un qui n'avait jamais rien vérifié.
 *
 * Rien de tout ça ne se voit dans un test de calcul : les montants sont justes, c'est leur MISE EN
 * SCÈNE qui ment. D'où ce test de rendu.
 */

const noop = () => {};

const reco = (over: any = {}) => ({
  type: 'save', title: 'Épargner', shortTitle: 'Épargner', description: '',
  amount: 400, actionAmount: 400, percentage: 40, color: '#0a0', icon: 'shield-outline',
  actionRoute: null, actionLabel: 'Transférer', ...over,
});

const baseProps: any = {
  relykaAmount: 1010,
  relykaColor: '#0b0',
  confidenceLevel: 'medium',
  daysSinceVerification: 6,
  recommendations: [],
  checkingBalance: 2000,
  spentThisMonth: 500,
  variableRemaining: 150,
  recurringUpcoming: 0,
  recurringUpcomingCount: 0,
  safetyMargin: 200,
  reservedTotal: 0,
  savedTotal: 0,
  investedTotal: 0,
  onOpenRelyka: noop,
  onOpenDetail: noop,
  onOpenMargin: noop,
  onOpenReserved: noop,
  onUpdateBalance: noop,
  onEpargner: noop,
  onInvestir: noop,
  onReserver: noop,
};

it.each([['1 €', 0.01], ['4 €', 4.27], ['10 €', 9.99]])('affiche réellement %s sur la carte principale', (label, amount) => {
  renderWithProviders(<PilotageSimple {...baseProps} relykaAmount={amount} />);
  expect(screen.getByText(label as string)).toBeTruthy();
});

describe('carte Relyka — la fourchette', () => {
  it('affiche le plancher, et un plafond qui ne dépasse jamais le Relyka', () => {
    renderWithProviders(
      <PilotageSimple {...baseProps} relykaRange={{ low: 900, high: 1010, isRange: true }} />,
    );
    expect(screen.getByText(/minimum sûr/)).toBeTruthy();
    expect(screen.getByText('900 €')).toBeTruthy();
    expect(screen.getByText(/jusqu’à/)).toBeTruthy();
    // Le plafond est bien affiché — et il vaut le Relyka, jamais davantage.
    expect(screen.getAllByText('1 010 €')).toHaveLength(2); // le chiffre principal + le plafond
  });

  /* Le doute se mesure sur le revenu / l'enveloppe, pas sur le Relyka : dès qu'il le dépasse, le
     plancher tombe à 0. « minimum sûr 0 € · jusqu'à 150 € » sous un « 150 € » n'apprend rien et
     inquiète pour rien — le badge « Estimation » dit déjà ce qu'il y a à dire. */
  it('masque la ligne quand le plancher tombe à 0', () => {
    renderWithProviders(
      <PilotageSimple {...baseProps} relykaAmount={150} relykaRange={{ low: 0, high: 150, isRange: true }} />,
    );
    expect(screen.queryByText(/minimum sûr/)).toBeNull();
    expect(screen.queryByText(/jusqu’à/)).toBeNull();
  });

  it('pas de fourchette du tout quand la confiance est haute', () => {
    renderWithProviders(
      <PilotageSimple {...baseProps} confidenceLevel="high" relykaRange={{ low: 1010, high: 1010, isRange: false }} />,
    );
    expect(screen.queryByText(/minimum sûr/)).toBeNull();
    expect(screen.queryByText(/jusqu’à/)).toBeNull();
  });
});

describe('carte Relyka — le badge d’état', () => {
  it('dit « À jour » quand tout est vérifié', () => {
    renderWithProviders(<PilotageSimple {...baseProps} confidenceLevel="high" />);
    expect(screen.getByText('À jour')).toBeTruthy();
  });

  it('n’affirme pas une vérification qui n’a jamais eu lieu', () => {
    renderWithProviders(<PilotageSimple {...baseProps} neverVerified daysSinceVerification={null} />);
    expect(screen.queryByText(/^Vérifié /)).toBeNull();
    expect(screen.getByText('Solde à vérifier')).toBeTruthy();
  });

  it('situe la vérification RÉELLE, même très ancienne', () => {
    renderWithProviders(<PilotageSimple {...baseProps} daysSinceVerification={240} />);
    expect(screen.getByText('Vérifié il y a longtemps')).toBeTruthy();
  });
});

/* Le grand chiffre est la première chose que l'app dit à quelqu'un qui l'ouvre. À 0 €, il ne disait
   rien — et surtout pas la différence entre « tu as tout placé » et « il te manque de l'argent ». */
describe('carte Relyka — quand le montant tombe à 0', () => {
  it('affiche le MOT à la place du chiffre, et le montant juste dessous', () => {
    renderWithProviders(
      <PilotageSimple
        {...baseProps}
        relykaAmount={0}
        relykaZero={{ word: 'Tout est placé', sub: '1 200 € mis de côté · 0 € libre' }}
      />,
    );
    expect(screen.getByText('Tout est placé')).toBeTruthy();
    expect(screen.getByText('1 200 € mis de côté · 0 € libre')).toBeTruthy();
    /* Le « 0 € » nu ne doit plus être LE chiffre principal. On regarde dans la zone du montant
       (celle qui ouvre le détail du calcul) : ailleurs sur la carte, « 0 € » reste légitime —
       les tuiles « Épargné » / « Investi » en affichent un quand rien n'a bougé. */
    const hero = within(screen.getByLabelText('Voir le détail du calcul'));
    expect(hero.getByText('Tout est placé')).toBeTruthy();
    expect(hero.queryByText('0 €')).toBeNull();
  });

  it('laisse le chiffre parler dès qu\'il vaut quelque chose', () => {
    renderWithProviders(<PilotageSimple {...baseProps} relykaAmount={1010} />);
    expect(screen.getByText('1 010 €')).toBeTruthy();
  });

  /* Pendant l'installation, le zéro n'est pas un choix : c'est un calcul qui n'a pas encore de quoi
     tourner. « Tout est engagé » posé au-dessus de « il n'a encore rien à calculer » affirmerait
     une décision que personne n'a prise, et contredirait la phrase juste en dessous. */
  it('ne met PAS de mot sur le zéro d\'un compte encore incomplet', () => {
    renderWithProviders(
      <PilotageSimple
        {...baseProps}
        relykaAmount={0}
        relykaZero={{ word: 'Tout est engagé', sub: "0 € libre d'ici la fin du mois" }}
        heroHint="Ton Relyka est à 0 € : il n'a encore rien à calculer."
      />,
    );
    expect(screen.queryByText('Tout est engagé')).toBeNull();
    expect(within(screen.getByLabelText('Voir le détail du calcul')).getByText('0 €')).toBeTruthy();
    expect(screen.getByText(/rien à calculer/)).toBeTruthy();
  });
});

describe('carte Relyka — le geste proposé sur une décision', () => {
  it('le bouton porte le montant PRÉ-REMPLI quand il diffère du montant affiché', () => {
    renderWithProviders(
      <PilotageSimple {...baseProps} recommendations={[reco({ amount: 400, actionAmount: 240 })]} />,
    );
    expect(screen.getByText('400 €')).toBeTruthy();   // ce que vaut la décision
    expect(screen.getByText('Virer 240 €')).toBeTruthy(); // ce que le bouton va réellement faire
  });

  it('sans écart, le bouton reste sobre', () => {
    renderWithProviders(
      <PilotageSimple {...baseProps} recommendations={[reco({ amount: 400, actionAmount: 400 })]} />,
    );
    expect(screen.getByText('Virer')).toBeTruthy();
  });

  /* « Conserver » ne sort rien du compte : le doute doit faire en garder PLUS, pas moins — donc
     jamais de montant réduit sur ce bouton (cf. le doute DIRECTIONNEL du moteur de recos). */
  it('« Réserver » n’est jamais servi à un montant réduit', () => {
    renderWithProviders(
      <PilotageSimple
        {...baseProps}
        recommendations={[reco({ type: 'keep', shortTitle: 'Réserver', amount: 300, actionAmount: 300, color: '#00f' })]}
      />,
    );
    // Le titre de la tuile ET le bouton disent « Réserver » — et surtout aucun montant réduit.
    expect(screen.getAllByText('Réserver').length).toBe(2);
    expect(screen.queryByText(/^Réserver \d/)).toBeNull();
  });
});
