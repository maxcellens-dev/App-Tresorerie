/**
 * Le simulateur d'administration branche des moteurs de calcul sur des composants de production.
 * Rien ne garantissait qu'il MONTE : ces écrans ne sont ouverts qu'à la main, et une prop devenue
 * obligatoire dans la carte Relyka ne se serait vue qu'au moment de s'en servir.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import ReliabilitySimulator from '../components/admin/ReliabilitySimulator';

describe('Admin — simulateur de fiabilité', () => {
  it('se monte et affiche le résultat calculé', async () => {
    renderWithProviders(<ReliabilitySimulator />);
    // Le résumé n'est rendu que si les moteurs ont tourné sans lever.
    expect(await screen.findByText('Niveau')).toBeTruthy();
    expect(screen.getByText('Doute retenu')).toBeTruthy();
    expect(screen.getByText('Effacé par les saisies')).toBeTruthy();
  });

  it('changer de scénario change les signaux envoyés au moteur', async () => {
    renderWithProviders(<ReliabilitySimulator />);
    await screen.findByText('Niveau');

    // Scénario par défaut « Suit tout, chaque jour » : chaque jour porte une dépense.
    expect(screen.getByText(/30 jour\(s\)\s*avec dépense/)).toBeTruthy();

    fireEvent.press(screen.getByText('Ne saisit rien'));
    await waitFor(() => {
      expect(screen.getByText(/0 jour\(s\)\s*avec dépense/)).toBeTruthy();
    });
  });

  /* Un scénario charge la SITUATION entière, pas seulement la façon de saisir : celui-ci bascule
     aussi « jamais vérifié », sans quoi il testerait un cas qui n'existe pas. */
  it('le scénario « Jamais vérifié » retire toute remise, quelle que soit la saisie', async () => {
    renderWithProviders(<ReliabilitySimulator />);
    await screen.findByText('Niveau');

    // Deux libellés identiques à l'écran : la puce du scénario (en tête) et l'interrupteur.
    fireEvent.press(screen.getAllByText('Jamais vérifié')[0]);
    await waitFor(() => {
      expect(screen.getByText(/sans objet/)).toBeTruthy();
    });
  });
});
