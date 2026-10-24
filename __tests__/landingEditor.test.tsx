import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { DEFAULT_LANDING, type LandingConfig } from '../hooks/config/useLandingConfig';
import AdminLanding from '../app/(tabs)/(secondary)/admin/landing';
import GardenLandingPage from '../components/marketing/GardenLandingPage';
import { mockRouter } from '../jest.setup';
import { signalAppReady } from '../lib/platform/splashGate';

jest.mock('../hooks/garden/useGardenFonts', () => ({ useGardenFonts: () => true }));
jest.mock('../hooks/garden/useGardenCosmetics', () => ({ useGardenCosmetics: () => ({ decor: [], outfit: {}, season: undefined }) }));
jest.mock('../lib/platform/splashGate', () => ({ signalAppReady: jest.fn() }));

let mockLoaded: LandingConfig | undefined;
let mockError = false;
const mockSave = jest.fn().mockResolvedValue(undefined);
jest.mock('../hooks/config/useLandingConfig', () => ({
  ...jest.requireActual('../hooks/config/useLandingConfig'),
  useLandingConfig: () => ({ data: mockLoaded, isError: mockError, refetch: jest.fn() }),
  useSaveLandingConfig: () => ({ mutateAsync: mockSave, isPending: false }),
}));
jest.mock('../hooks/theme/useBrandColors', () => ({ useBrandColors: () => ({ emerald: '#34D399', onAccent: '#123B37' }) }));
jest.mock('../hooks/theme/useBrandFont', () => ({ useAppNameFontStyle: () => ({}), useAppNameFontReady: () => true, useBodyFontStyle: () => ({}), APP_NAME_TEXT_PROPS: {} }));
jest.mock('../hooks/theme/useAppColors', () => ({ useAppColors: () => ({ bg: '#fff', card: '#fff', text: '#163D39', textSecondary: '#536B65', cardBorder: '#ddd', emerald: '#34D399', onAccent: '#123B37' }) }));
jest.mock('../hooks/theme/useResponsive', () => ({ useResponsive: () => ({ isDesktop: true }) }));
jest.mock('../hooks/platform/useNavBack', () => ({ useNavBack: () => jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../hooks/data/useProfile', () => ({ useProfile: () => ({ data: null }) }));
jest.mock('../components/layout/ScreenGradient', () => () => null);
jest.mock('../components/layout/ScreenHeader', () => () => null);
jest.mock('../components/layout/KeyboardAwareScrollView', () => ({ __esModule: true, default: require('react-native').ScrollView }));

beforeEach(() => {
  mockLoaded = structuredClone(DEFAULT_LANDING);
  mockError = false;
  mockSave.mockClear();
  mockRouter.push.mockClear();
  (signalAppReady as jest.Mock).mockClear();
});

it('keeps the showcase and its login link available when loading fails', () => {
  mockLoaded = undefined;
  render(<GardenLandingPage previewWidth={390} />);
  expect(screen.getByText('Sache ce que tu peux vraiment dépenser.')).toBeTruthy();
  fireEvent.press(screen.getAllByText("J'ai déjà un compte")[0]);
  expect(mockRouter.push).toHaveBeenCalledWith('/login');
});

it('renders an old preview draft without presentation settings', () => {
  const { presentation: _newFields, ...oldDraft } = DEFAULT_LANDING;
  render(<GardenLandingPage previewConfig={{ ...oldDraft, brandName: 'Ma marque' } as LandingConfig} previewWidth={390} />);
  expect(screen.getAllByText('Ma marque').length).toBeGreaterThan(0);
});

it('opens the editor with legacy settings and preserves the existing values', () => {
  const { presentation: _newFields, ...oldConfig } = DEFAULT_LANDING;
  mockLoaded = { ...oldConfig, brandName: 'Marque déjà enregistrée' } as LandingConfig;
  render(<AdminLanding />);
  expect(screen.getByLabelText('Nom de la marque').props.value).toBe('Marque déjà enregistrée');
});

it('edits the key figures, preserves the rest and saves the draft', async () => {
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('Pied de page'));
  fireEvent.changeText(screen.getByLabelText('Texte du pied de page'), 'Mon pied de page');
  fireEvent.press(screen.getByText("Enregistrer la page d'accueil"));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  const saved = mockSave.mock.calls[0][0];
  expect(saved.footerText).toBe('Mon pied de page');
  expect(saved.brandName).toBe(DEFAULT_LANDING.brandName);
});

it('previews unsaved showcase settings without persisting them', () => {
  render(<AdminLanding />);
  fireEvent.changeText(screen.getByLabelText('Nom de la marque'), 'Un nouveau nom');
  fireEvent.press(screen.getByText('Aperçu site mobile'));
  expect(screen.getAllByText('Un nouveau nom').length).toBeGreaterThan(0);
  expect(mockSave).not.toHaveBeenCalled();
});

it('previews the installed application with unsaved native copy', () => {
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('Application'));
  fireEvent.changeText(screen.getByLabelText('Bouton principal'), 'Entrer dans mon jardin');
  fireEvent.press(screen.getByText('Aperçu application installée'));
  // l'accueil reprend le slogan du Jardin (mêmes mots que la vitrine web), avec le bouton non enregistré
  expect(screen.getByText('Sache ce que tu peux vraiment dépenser.')).toBeTruthy();
  expect(screen.getByText('Entrer dans mon jardin')).toBeTruthy();
  expect(signalAppReady).not.toHaveBeenCalled();
  expect(screen.queryByText(DEFAULT_LANDING.heroTitle)).toBeNull();
  fireEvent.press(screen.getByText('Entrer dans mon jardin'));
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});

it('keeps all three preview choices accessible from either editor tab', () => {
  render(<AdminLanding />);
  for (const tab of ['Application', 'Site web']) {
    fireEvent.press(screen.getByText(tab));
    expect(screen.getByText('Aperçu bureau')).toBeTruthy();
    expect(screen.getByText('Aperçu site mobile')).toBeTruthy();
    expect(screen.getByText('Aperçu application installée')).toBeTruthy();
  }
});

it('does not expose a writable form when the configuration cannot be loaded', () => {
  mockError = true;
  render(<AdminLanding />);
  expect(screen.getByText('Configuration non chargée')).toBeTruthy();
  expect(screen.queryByText("Enregistrer la page d'accueil")).toBeNull();
});

