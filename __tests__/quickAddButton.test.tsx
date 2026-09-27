import { Animated, StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import QuickAddButton from '../components/transaction/QuickAddButton';
import { mockRouter } from '../jest.setup';

let mockPathname = '/comptes';
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));
jest.mock('../hooks/theme/useAppColors', () => ({
  useAppColors: () => ({
    bg: '#101010', card: '#202020', emerald: '#10b981', teal: '#14b8a6',
    blue: '#3b82f6', danger: '#ef4444', green: '#22c55e',
  }),
}));

const actions = [
  ['Virement', '/(tabs)/transactions/add?type=transfer&origin=%2Fcomptes'],
  ['Dépense', '/(tabs)/transactions/add?type=expense&origin=%2Fcomptes'],
  ['Recette', '/(tabs)/transactions/add?type=income&origin=%2Fcomptes'],
  ['Mettre à jour mon solde', '/(tabs)/comptes/solde?origin=%2Fcomptes'],
] as const;
const toggle = () => fireEvent.press(screen.getByRole('button', { name: /Saisie rapide/ }));

beforeEach(() => {
  jest.useFakeTimers();
  mockPathname = '/comptes';
  // Le ressort natif reste en cours : les appuis ne doivent pas attendre sa fin.
  jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(actions)('ouvre %s au premier appui pendant le déploiement', (label, route) => {
  render(<QuickAddButton />);
  toggle();
  fireEvent.press(screen.getByRole('button', { name: label }));
  act(() => jest.advanceTimersByTime(60));
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith(route);
});

it('garde les cibles tactiles sans transformation pendant le ressort natif', () => {
  render(<QuickAddButton />);
  toggle();
  for (const [label] of actions) {
    // Fabric mesure les ancêtres de la cible : un scale animé sur l'un d'eux
    // peut différer de la position visible sur Android et annuler le premier appui.
    let node = screen.getByRole('button', { name: label });
    while (node) {
      if (typeof node.type === 'string') {
        expect(StyleSheet.flatten(node.props.style)?.transform ?? []).toEqual([]);
      }
      node = node.parent!;
    }
  }
});

it('place les actions dans les limites de leur conteneur tactile', () => {
  render(<QuickAddButton />);
  toggle();
  for (const [label] of actions) {
    const boxes = [];
    let node = screen.getByRole('button', { name: label });
    while (node) {
      const style = StyleSheet.flatten(node.props.style);
      if (typeof node.type === 'string' && style?.position === 'absolute') boxes.push(style);
      node = node.parent!;
    }
    const [action, container] = boxes;
    expect(action.left).toBeGreaterThanOrEqual(0);
    expect(action.top).toBeGreaterThanOrEqual(0);
    expect(action.left + action.width).toBeLessThanOrEqual(container.width);
    expect(action.top + action.height).toBeLessThanOrEqual(container.height);
  }
});

it('désactive les actions dès la fermeture du menu', () => {
  jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  render(<QuickAddButton />);
  toggle();
  toggle();
  for (const [label] of actions) {
    const button = screen.getByRole('button', { name: label });
    expect(button).toBeDisabled();
    fireEvent.press(button);
  }
  act(() => jest.advanceTimersByTime(300));
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Dépense' })).toBeNull();
});

it('conserve le compte source et l’écran de retour', () => {
  mockPathname = '/comptes/3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  render(<QuickAddButton />);
  toggle();
  fireEvent.press(screen.getByRole('button', { name: 'Dépense' }));
  act(() => jest.advanceTimersByTime(60));
  expect(mockRouter.push).toHaveBeenCalledWith(
    '/(tabs)/transactions/add?type=expense&account=3f2504e0-4f89-11d3-9a0c-0305e82c3301&origin=%2Fcomptes%2F3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  );
});
