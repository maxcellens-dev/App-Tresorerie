import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders, screen } from './utils/renderWithProviders';
import { PilotageLoading } from '../components/pilotage/PilotageSimple';

it('affiche les trois sections et les libellés sans montant ni diagnostic prématuré', () => {
  const { unmount } = renderWithProviders(<PilotageLoading />);
  for (const label of ['Ton Relyka', 'Tes recommandations', 'Ce mois-ci', 'Tu as sur tes comptes', 'Tu as dépensé', 'Tu devrais encore dépenser', 'Tu veux garder au moins', 'Réservé', 'Épargné', 'Investi']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.queryByText(/€/)).toBeNull();
  expect(screen.queryByText('À jour')).toBeNull();
  expect(screen.queryByText(/Relyka épuisé|Rien à répartir/)).toBeNull();
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  unmount();
});

it('conserve les cartes lors d’une erreur, arrête le chargement et permet de réessayer', () => {
  const retry = jest.fn();
  const { unmount } = renderWithProviders(<PilotageLoading error="Connexion interrompue." onRetry={retry} />);
  expect(screen.getByText('Ce mois-ci')).toBeTruthy();
  expect(screen.getByText('Tes recommandations')).toBeTruthy();
  expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/€/)).toBeNull();
  unmount();
});
