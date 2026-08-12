import { renderWithProviders, screen, fireEvent } from './utils/renderWithProviders';
import DetailModal from '../components/pilotage/DetailModal';

/**
 * VERROU SUR LE DÉCOUPAGE DE `DetailModal` (675 lignes, cf. docs/PLAN_REFACTOR_TESTS.md).
 *
 * Cette modale était la seule du Pilotage à ne pas être un simple déplacement : elle a été refondue
 * en quatre sous-blocs, et les filtres sont descendus dans les vues qu'ils pilotent. Rien, dans
 * `tsc` ni dans les tests de calcul, n'aurait rattrapé une donnée mal recâblée en chemin — un
 * montant branché sur la mauvaise prop reste parfaitement typé.
 *
 * On éprouve donc ce qui se voit à l'écran : les bons chiffres, aux bons endroits, dans chaque vue.
 */

const colors: any = {
  bg: '#000', card: '#111', cardSolid: '#111', cardBorder: '#222', text: '#fff', textSecondary: '#999',
  green: '#0a0', emerald: '#0b0', danger: '#f00', orange: '#fa0', violet: '#a0f', blue: '#00f',
  teal: '#0aa', yellow: '#ff0', checking: '#0ff',
};

const pilotageData: any = {
  current_checking_balance: 2000, cashflow_trough: 1200, month_income_remaining: 0,
  month_savings_future: 100, month_invest_future: 50, month_savings_total: 300, month_invest_total: 50,
  monthly_reserve_planned: 30, month_expenses_past: 900,
  variable_envelope_initial: 400, variable_envelope_spent: 250, variable_envelope_remaining: 150,
  variable_envelope_source: 'history', variable_envelope_months_used: 3,
  variable_real_available: true, variable_real_value: 380, variable_estimate_value: 420,
  variable_real_months: 4, safety_margin_amount: 200,
};

const tx = (over: any = {}) => ({
  id: 'tx-1', account_id: 'acc-1', amount: -50, date: '2026-06-10',
  category: { name: 'Courses', type: 'expense' }, ...over,
});

const suiviDetail = {
  checking: [{ id: 'acc-1', name: 'Compte courant', balance: 2000 }],
  savings: [tx({ id: 's1', amount: -200, note: 'Virement épargne' })],
  invest: [tx({ id: 'i1', amount: -300, note: 'Virement PEA' })],
  spent: [
    tx({ id: 'sp1', amount: -120, note: 'Supermarché' }),
    tx({ id: 'sp2', amount: -80, note: 'Essence', category: { name: 'Transport', type: 'expense' } }),
  ],
  recurrentes: [
    tx({ id: 'r1', amount: -800, note: 'Loyer', _monthTotal: 800, _monthPassed: 800, _monthDate: '2026-06-05', category: { name: 'Logement', type: 'expense' } }),
    tx({ id: 'r2', amount: -30, note: 'Assurance', _monthTotal: 30, _monthPassed: 0, _monthDate: '2026-06-25', category: { name: 'Assurance', type: 'expense' } }),
  ],
  recurringTotal: 830,
  recurringPassed: 800,
};

const recurUpcoming = {
  amount: 30, count: 1,
  list: [tx({ id: 'r2', amount: -30, note: 'Assurance', _left: 30, _monthDate: '2026-06-25' })],
};

const baseProps: any = {
  detailKey: null,
  onClose: jest.fn(),
  plannedTab: 'recurrentes',
  suiviDetail,
  recurUpcoming,
  pilotageData,
  profile: { currency_code: 'EUR', weekly_variable_budget: 100 },
  accounts: [{ id: 'acc-1', currency: 'EUR', type: 'checking', balance: 2000 }],
  rates: { EUR: 1 },
  catParentName: {},
  reservationsTotal: 40,
  cumulsTotal: 15,
  resteDisponible: 615,
  relykaAffiche: 610,
  troughDate: '2026-06-24',
  troughExplain: 'Le 24 juin : c\'est le jour où ton solde sera au plus bas (1 200 €).',
  varMode: 'auto',
  onVarMode: jest.fn(),
  varModeDirty: false,
  savingVarMode: false,
  onSaveVarMode: jest.fn(),
  scrollMaxHeight: 460,
  isDesktop: false,
  colors,
  onPressTx: jest.fn(),
  onShowRecurring: jest.fn(),
  onShowTroughInfo: jest.fn(),
  onEditEstimate: jest.fn(),
  onSetMargin: jest.fn(),
  onOpenProfile: jest.fn(),
};

const show = (over: any = {}) => renderWithProviders(<DetailModal {...baseProps} {...over} />);

describe('DetailModal — aiguillage et en-tête', () => {
  it('ne montre rien tant qu\'aucune clé n\'est ouverte', () => {
    show({ detailKey: null });
    expect(screen.queryByText('Dépensé ce mois')).toBeNull();
  });

  it.each([
    ['checking', 'Budget courant actuel'],
    ['savings', 'Épargne du mois'],
    ['invest', 'Investissement du mois'],
    ['spent', 'Dépensé ce mois'],
    ['planned_simple', 'Ce qui va encore sortir'],
    ['relyka', 'Ton Relyka (Budget libre)'],
  ])('titre de la vue « %s »', (key, title) => {
    show({ detailKey: key });
    expect(screen.getByText(title)).toBeOnTheScreen();
  });

  it('titre la vue « planned » selon son onglet, et non par sa clé', () => {
    show({ detailKey: 'planned', plannedTab: 'recurrentes' });
    expect(screen.getByText('Dépenses récurrentes')).toBeOnTheScreen();
    show({ detailKey: 'planned', plannedTab: 'variables' });
    expect(screen.getByText('Dépenses variables prévues restantes')).toBeOnTheScreen();
  });

  it('ferme au bouton Fermer', () => {
    const onClose = jest.fn();
    show({ detailKey: 'spent', onClose });
    fireEvent.press(screen.getByLabelText('Fermer'));
    expect(onClose).toHaveBeenCalled();
  });

  it("n'offre le raccourci « toutes les récurrentes » que là où il a du sens", () => {
    show({ detailKey: 'planned_simple' });
    expect(screen.getByLabelText('Toutes les transactions récurrentes')).toBeOnTheScreen();
    // Dans « Dépensé ce mois », il envoyait vers des MODÈLES alors qu'on regarde des opérations passées.
    show({ detailKey: 'spent' });
    expect(screen.queryByLabelText('Toutes les transactions récurrentes')).toBeNull();
  });
});

describe('DetailModal — vue « Budget courant »', () => {
  it('liste les comptes courants avec leur solde', () => {
    show({ detailKey: 'checking' });
    expect(screen.getByText('Compte courant')).toBeOnTheScreen();
    expect(screen.getByText('2 000 €')).toBeOnTheScreen();
  });

  it("n'affiche la ligne des recettes à venir que s'il y en a", () => {
    show({ detailKey: 'checking' });
    expect(screen.queryByText('Recettes prévues restantes')).toBeNull();
    show({ detailKey: 'checking', pilotageData: { ...pilotageData, month_income_remaining: 1800 } });
    expect(screen.getByText('Recettes prévues restantes')).toBeOnTheScreen();
    expect(screen.getByText('+1 800 €')).toBeOnTheScreen();
  });
});

describe('DetailModal — vues Épargne / Investissement', () => {
  it('affiche les virements du mois, montant en positif dans la liste', () => {
    show({ detailKey: 'savings' });
    expect(screen.getByText('Virement épargne')).toBeOnTheScreen();
    expect(screen.getByText('200 €')).toBeOnTheScreen();
  });

  it('ouvre le détail d\'une opération au tap', () => {
    const onPressTx = jest.fn();
    show({ detailKey: 'invest', onPressTx });
    fireEvent.press(screen.getByText('Virement PEA'));
    expect(onPressTx).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }));
  });

  it('annonce le vide plutôt que de rendre une liste muette', () => {
    show({ detailKey: 'savings', suiviDetail: { ...suiviDetail, savings: [] } });
    expect(screen.getByText("Aucun virement d'épargne ce mois.")).toBeOnTheScreen();
  });
});

describe('DetailModal — vue « Dépensé ce mois » et ses filtres', () => {
  it('liste les dépenses passées du mois', () => {
    show({ detailKey: 'spent' });
    expect(screen.getByText('Supermarché')).toBeOnTheScreen();
    expect(screen.getByText('Essence')).toBeOnTheScreen();
  });

  it('propose le filtre « À venir » dès qu\'il reste des récurrentes à prélever', () => {
    show({ detailKey: 'spent' });
    expect(screen.getByText('À venir')).toBeOnTheScreen();
  });

  it('bascule la liste sur les récurrentes à venir quand on active ce filtre', () => {
    show({ detailKey: 'spent' });
    fireEvent.press(screen.getByText('À venir'));
    // La liste montre désormais ce qui va tomber, pas ce qui est déjà parti.
    expect(screen.getByText('Assurance')).toBeOnTheScreen();
    expect(screen.queryByText('Supermarché')).toBeNull();
  });

  it('filtre la liste par catégorie au clic sur une pastille de la légende', () => {
    show({ detailKey: 'spent' });
    fireEvent.press(screen.getByText('Transport'));
    expect(screen.getByText('Essence')).toBeOnTheScreen();
    expect(screen.queryByText('Supermarché')).toBeNull();
  });

  it('re-clique la pastille active pour revenir à la liste entière', () => {
    show({ detailKey: 'spent' });
    fireEvent.press(screen.getByText('Transport'));
    fireEvent.press(screen.getByText('Transport'));
    expect(screen.getByText('Supermarché')).toBeOnTheScreen();
  });

  it('ne cache pas la liste quand il n\'y a rien à montrer', () => {
    show({ detailKey: 'spent', suiviDetail: { ...suiviDetail, spent: [] }, recurUpcoming: { amount: 0, count: 0, list: [] } });
    expect(screen.getByText('Aucune dépense passée ce mois.')).toBeOnTheScreen();
  });
});

describe('DetailModal — vue « Ce qui va encore sortir »', () => {
  it('additionne variables estimées et récurrentes non prélevées', () => {
    show({ detailKey: 'planned_simple' });
    expect(screen.getByText('Total à venir')).toBeOnTheScreen();
    expect(screen.getByText('180 €')).toBeOnTheScreen(); // 150 variables + 30 récurrentes
  });

  it("expose les trois origines de l'enveloppe avec la valeur de chacune", () => {
    show({ detailKey: 'planned_simple' });
    expect(screen.getByText('Auto')).toBeOnTheScreen();
    expect(screen.getByText('Estimation')).toBeOnTheScreen();
    // « Calculé » et non « Réel » : c'est une moyenne des mois passés.
    expect(screen.getByText('Calculé')).toBeOnTheScreen();
    expect(screen.getByText('420 €')).toBeOnTheScreen();
  });

  it('marque « 2 mois requis » quand le calculé n\'est pas disponible', () => {
    show({ detailKey: 'planned_simple', pilotageData: { ...pilotageData, variable_real_available: false } });
    expect(screen.getByText('2 mois requis')).toBeOnTheScreen();
  });

  it("n'offre « Enregistrer » que lorsque le mode a réellement changé", () => {
    show({ detailKey: 'planned_simple', varModeDirty: false });
    expect(screen.queryByText('Enregistrer')).toBeNull();
    show({ detailKey: 'planned_simple', varModeDirty: true });
    expect(screen.getByText('Enregistrer')).toBeOnTheScreen();
  });

  it('remonte le changement de mode à l\'écran', () => {
    const onVarMode = jest.fn();
    show({ detailKey: 'planned_simple', onVarMode });
    fireEvent.press(screen.getByText('Estimation'));
    expect(onVarMode).toHaveBeenCalledWith('estimate');
  });

  it('dit que tout est passé plutôt que d\'afficher une liste vide', () => {
    show({ detailKey: 'planned_simple', recurUpcoming: { amount: 0, count: 0, list: [] } });
    expect(screen.getByText('Toutes tes dépenses récurrentes du mois sont déjà passées.')).toBeOnTheScreen();
  });
});

describe('DetailModal — vue « Ton Relyka » (le détail du calcul)', () => {
  it('part du point bas, et le date', () => {
    show({ detailKey: 'relyka' });
    expect(screen.getByText(/Point bas de trésorerie/)).toBeOnTheScreen();
    expect(screen.getByText('1 200 €')).toBeOnTheScreen();
  });

  it('explique jusqu\'à quand le Relyka est contraint', () => {
    show({ detailKey: 'relyka' });
    expect(screen.getByText(/le jour où ton solde sera au plus bas/)).toBeOnTheScreen();
  });

  it('sépare ce qui est DÉJÀ compris dans le point bas des déductions', () => {
    show({ detailKey: 'relyka' });
    expect(screen.getByText('Déjà compris dans le point bas :')).toBeOnTheScreen();
    expect(screen.getByText('Épargne & investissement à venir')).toBeOnTheScreen();
    expect(screen.getByText('Marge de sécurité')).toBeOnTheScreen();
  });

  it('additionne réservations, cumuls et réservé de projet sur UNE ligne « Somme réservée »', () => {
    show({ detailKey: 'relyka' });
    // 30 (réservé projet) + 40 (réservations) + 15 (cumuls) = 85
    expect(screen.getByText('− 85 €')).toBeOnTheScreen();
  });

  it('conclut sur le Relyka, et signale l\'arrondi de la carte', () => {
    show({ detailKey: 'relyka' });
    expect(screen.getByText('Ton Relyka')).toBeOnTheScreen();
    expect(screen.getByText('615 €')).toBeOnTheScreen();
    expect(screen.getByText(/Arrondi à 610 €/)).toBeOnTheScreen();
  });

  it('ne parle d\'arrondi que lorsqu\'il y en a un', () => {
    show({ detailKey: 'relyka', resteDisponible: 610, relykaAffiche: 610 });
    expect(screen.queryByText(/Arrondi à/)).toBeNull();
  });

  it('invite à définir la marge quand elle vaut 0, au lieu d\'un « − 0 € » muet', () => {
    const onSetMargin = jest.fn();
    show({ detailKey: 'relyka', pilotageData: { ...pilotageData, safety_margin_amount: 0 }, onSetMargin });
    const nudge = screen.getByText(/marge de sécurité à 0€/);
    expect(nudge).toBeOnTheScreen();
    fireEvent.press(nudge);
    expect(onSetMargin).toHaveBeenCalled();
  });

  it('ne montre pas cette invitation quand la marge est définie', () => {
    show({ detailKey: 'relyka' });
    expect(screen.queryByText(/marge de sécurité à 0€/)).toBeNull();
  });
});

describe('DetailModal — les filtres ne survivent pas au changement de vue', () => {
  it("repart de la liste entière quand on rouvre « Dépensé » après avoir filtré", () => {
    const { rerender } = show({ detailKey: 'spent' });
    fireEvent.press(screen.getByText('Transport'));
    expect(screen.queryByText('Supermarché')).toBeNull();

    // On quitte la vue (le sous-bloc est démonté), puis on y revient.
    rerender(<DetailModal {...baseProps} detailKey={null} />);
    rerender(<DetailModal {...baseProps} detailKey="spent" />);

    expect(screen.getByText('Supermarché')).toBeOnTheScreen();
  });
});
