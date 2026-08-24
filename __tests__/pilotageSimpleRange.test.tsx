import { renderWithProviders, screen } from './utils/renderWithProviders';
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
