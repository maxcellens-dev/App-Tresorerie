/**
 * L'écran d'administration de la fiabilité rend des composants de PRODUCTION avec des états forcés
 * — un contrat fragile par nature : il suffit qu'une carte exige une nouvelle prop pour que la page
 * blanchisse, sans que rien d'autre ne bronche. On vérifie donc qu'il monte, onglet par onglet.
 */
import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from './utils/renderWithProviders';
import AdminReliability from '../app/(tabs)/(secondary)/admin/reliability';
import BannersGallery from '../components/admin/BannersGallery';

describe('Admin — Fiabilité & confiance', () => {
  it('ouvre sur les réglages, avec ses quatre onglets', async () => {
    renderWithProviders(<AdminReliability />);
    expect(await screen.findByText('Réglages du doute')).toBeTruthy();
    for (const label of ['Simulateur', 'Bandeaux', 'Le calcul']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('chaque onglet monte son contenu, et lui seul', async () => {
    renderWithProviders(<AdminReliability />);
    await screen.findByText('Réglages du doute');

    fireEvent.press(screen.getByText('Simulateur'));
    await waitFor(() => expect(screen.getByText('Niveau')).toBeTruthy());
    // Les réglages ne sont plus montés : les onglets trient vraiment la page.
    expect(screen.queryByText('Réglages du doute')).toBeNull();
    /* Le simulateur rend la VRAIE carte du tableau de bord (PilotageSimple), pas l'ancien carrousel
       en colonnes qui a quitté la production. « Ce mois-ci » n'appartient qu'à elle. */
    // (« Ton Relyka » apparaît deux fois : l'en-tête de la carte et l'étiquette de son message.)
    expect(screen.getAllByText('Ton Relyka').length).toBeGreaterThan(0);
    expect(screen.getByText('Ce mois-ci')).toBeTruthy();

    fireEvent.press(screen.getByText('Bandeaux'));
    await waitFor(() => expect(screen.getByText(/Bandeau « prochain geste »/)).toBeTruthy());

    fireEvent.press(screen.getByText('Le calcul'));
    await waitFor(() => expect(screen.getByText('Le calcul, pas à pas')).toBeTruthy());
  });
});

describe('Admin — galerie de bandeaux', () => {
  /* Le bandeau « prochain geste » ne doit plus jamais réclamer le solde : la carte Relyka porte
     déjà l'information, là où le chiffre se lit. */
  it('aucune variante ne parle du solde', async () => {
    renderWithProviders(<BannersGallery />);
    expect(await screen.findByText(/Bandeau « prochain geste »/)).toBeTruthy();
    expect(screen.queryByText(/Renseigne ton solde/)).toBeNull();
    expect(screen.queryByText(/Vérifie ton solde/)).toBeNull();
  });

  it('rend les variantes restantes du moteur d’état', async () => {
    renderWithProviders(<BannersGallery />);
    await screen.findByText(/Bandeau « prochain geste »/);
    expect(screen.getByText('Ajoute ton revenu principal')).toBeTruthy();
    // Deux occurrences attendues : l'intitulé du cas, puis le titre du bandeau rendu en dessous.
    expect(screen.getAllByText('Compte commun bientôt à découvert').length).toBeGreaterThan(0);
  });
});
