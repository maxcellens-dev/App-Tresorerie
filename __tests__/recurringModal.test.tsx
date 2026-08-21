/**
 * Modal « Transactions récurrentes » — le tri par ONGLETS (Virements / Dépenses / Recettes).
 *
 * Les trois natures se lisaient à la suite dans une seule liste : au-delà d'une dizaine de
 * récurrentes, retrouver un virement demandait de traverser toutes les dépenses. Ce qui se teste
 * ici n'est pas le rendu mais la RÈGLE de sélection — quel onglet s'ouvre, et ce que voit
 * l'utilisateur quand un onglet est vide.
 */
import { renderWithProviders, screen, fireEvent } from './utils/renderWithProviders';
import RecurringTransactionsModal from '../components/transaction/RecurringTransactionsModal';

/* On neutralise la requête réseau et on injecte directement la liste : le test porte sur le tri,
   pas sur la lecture Supabase (déjà couverte ailleurs). */
let mockItems: any[] = [];
/* `refetch` est STABLE (une seule instance), comme celui que rend react-query. Le recréer à chaque
   rendu relancerait l'effet d'ouverture de la feuille en boucle — le test échouerait alors pour une
   raison qui n'existe pas dans l'app. */
const mockRefetch = jest.fn();
jest.mock('../hooks/data/useRecurringTransactions', () => {
  const actual = jest.requireActual('../hooks/data/useRecurringTransactions');
  return {
    ...actual,
    useRecurringTransactions: () => ({ data: mockItems, isLoading: false, refetch: mockRefetch }),
  };
});

const item = (over: Partial<any> = {}) => ({
  id: Math.random().toString(36).slice(2),
  kind: 'expense',
  label: 'Loyer',
  amount: 800,
  rule: 'monthly',
  nextDate: '2026-09-05',
  accountName: 'Compte courant',
  accountCurrency: 'EUR',
  upcoming: true,
  ...over,
});

const show = () =>
  renderWithProviders(
    <RecurringTransactionsModal visible onClose={jest.fn()} userId="u1" />,
  );

afterEach(() => { mockItems = []; });

describe('onglets par nature', () => {
  it('affiche les trois onglets avec leur compte', () => {
    mockItems = [
      item({ kind: 'transfer', label: 'Vers le joint' }),
      item({ kind: 'expense', label: 'Loyer' }),
      item({ kind: 'expense', label: 'Engie' }),
      item({ kind: 'income', label: 'Salaire' }),
    ];
    show();
    expect(screen.getByText('Virements')).toBeOnTheScreen();
    expect(screen.getByText('Dépenses')).toBeOnTheScreen();
    expect(screen.getByText('Recettes')).toBeOnTheScreen();
    // Le compteur de chaque onglet : c'est lui qui signale qu'il y a du contenu ailleurs.
    expect(screen.getByLabelText('Dépenses — 2 récurrentes')).toBeOnTheScreen();
    expect(screen.getByLabelText('Recettes — 1 récurrente')).toBeOnTheScreen();
  });

  it('n\'affiche QUE les lignes de l\'onglet actif', () => {
    mockItems = [
      item({ kind: 'transfer', label: 'Vers le joint' }),
      item({ kind: 'expense', label: 'Loyer' }),
    ];
    show();
    // Ouverture sur « Virements » : premier onglet rempli dans l'ordre naturel.
    expect(screen.getByText('Vers le joint')).toBeOnTheScreen();
    expect(screen.queryByText('Loyer')).toBeNull();
  });

  it('bascule sur l\'onglet touché', () => {
    mockItems = [
      item({ kind: 'transfer', label: 'Vers le joint' }),
      item({ kind: 'expense', label: 'Loyer' }),
    ];
    show();
    fireEvent.press(screen.getByText('Dépenses'));
    expect(screen.getByText('Loyer')).toBeOnTheScreen();
    expect(screen.queryByText('Vers le joint')).toBeNull();
  });

  /* Sans cette règle, un utilisateur sans aucun virement ouvrait la feuille sur un onglet vide,
     ses dépenses cachées derrière un onglet qu'il n'a pas pensé à toucher. */
  it('s\'ouvre sur le premier onglet REMPLI, pas sur le premier onglet', () => {
    mockItems = [item({ kind: 'expense', label: 'Loyer' })];
    show();
    expect(screen.getByText('Loyer')).toBeOnTheScreen();
  });

  it('dit ce qui manque quand on ouvre un onglet vide', () => {
    mockItems = [item({ kind: 'expense', label: 'Loyer' })];
    show();
    fireEvent.press(screen.getByText('Recettes'));
    expect(screen.getByText('Aucune recette récurrente.')).toBeOnTheScreen();
    expect(screen.queryByText('Loyer')).toBeNull();
  });

  it('garde le message général quand il n\'y a aucune récurrente du tout', () => {
    mockItems = [];
    show();
    expect(screen.getByText(/Aucune transaction récurrente active/)).toBeOnTheScreen();
    // Pas d'onglets à afficher s'il n'y a rien à trier.
    expect(screen.queryByText('Virements')).toBeNull();
  });
});

describe('montants', () => {
  it('affiche le montant dans la devise du COMPTE, pas en devise de référence', () => {
    mockItems = [item({ kind: 'expense', label: 'Loyer Genève', amount: 1200, accountCurrency: 'CHF' })];
    show();
    expect(screen.getByText(/CHF/)).toBeOnTheScreen();
  });
});
