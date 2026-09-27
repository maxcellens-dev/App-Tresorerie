import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import UpdateOnLaunchGate from '../components/system/UpdateOnLaunchGate';
import { useUpdateOnLaunch } from '../lib/platform/otaUpdate';

jest.mock('../lib/platform/otaUpdate', () => ({ useUpdateOnLaunch: jest.fn() }));
jest.mock('../hooks/theme/useBrandColors', () => ({
  useBrandColors: () => ({ mode: 'light', emerald: '#00B5C8' }),
}));

const mockUpdate = jest.mocked(useUpdateOnLaunch);

beforeEach(() => {
  jest.useFakeTimers();
  mockUpdate.mockReturnValue({ waiting: true, downloading: true, progress: 0.42 });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function revealCaption() {
  act(() => { jest.advanceTimersByTime(1600); });
}

it('affiche et actualise le pourcentage réel du téléchargement', () => {
  const { rerender } = render(<UpdateOnLaunchGate />);
  revealCaption();
  expect(screen.getByText('42 %')).toBeTruthy();
  expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  mockUpdate.mockReturnValue({ waiting: true, downloading: true, progress: 0.73 });
  rerender(<UpdateOnLaunchGate />);
  expect(screen.getByText('73 %')).toBeTruthy();
});

it.each([null, NaN, Infinity])('ne fabrique pas de pourcentage si la progression est inconnue (%s)', progress => {
  mockUpdate.mockReturnValue({ waiting: true, downloading: true, progress });
  render(<UpdateOnLaunchGate />);
  revealCaption();
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.getByRole('progressbar').props.accessibilityValue).toBeUndefined();
});

it('ne présente pas une ancienne progression comme un téléchargement pendant la recherche', () => {
  mockUpdate.mockReturnValue({ waiting: true, downloading: false, progress: 1 });
  render(<UpdateOnLaunchGate />);
  revealCaption();
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.getByText('Vérification des mises à jour…')).toBeTruthy();
});

it('retire le voile dès que l’attente se termine', () => {
  const { rerender } = render(<UpdateOnLaunchGate />);
  revealCaption();
  mockUpdate.mockReturnValue({ waiting: false, downloading: false, progress: null });
  rerender(<UpdateOnLaunchGate />);
  expect(screen.toJSON()).toBeNull();
});
