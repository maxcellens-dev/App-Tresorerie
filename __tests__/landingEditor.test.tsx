import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Image } from 'react-native';
import { DEFAULT_LANDING, type LandingConfig } from '../hooks/config/useLandingConfig';
import AdminLanding from '../app/(tabs)/(secondary)/admin/landing';
import LandingPage from '../components/marketing/LandingPage';
import LandingMedia from '../components/marketing/LandingMedia';
import { mockRouter } from '../jest.setup';
import { signalAppReady } from '../lib/platform/splashGate';

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

it('keeps login and the product demonstration available when loading fails', () => {
  mockLoaded = undefined;
  render(<LandingPage previewWidth={390} />);
  expect(screen.getByText(DEFAULT_LANDING.heroTitle)).toBeTruthy();
  expect(screen.getByText(DEFAULT_LANDING.heroBalanceValue)).toBeTruthy();
  fireEvent.press(screen.getAllByText(DEFAULT_LANDING.ctaSecondaryLabel)[0]);
  expect(mockRouter.push).toHaveBeenCalledWith('/login');
});

it('renders an old preview draft without presentation settings', () => {
  const { presentation: _newFields, ...oldDraft } = DEFAULT_LANDING;
  render(<LandingPage previewConfig={oldDraft as LandingConfig} previewWidth={390} />);
  expect(screen.getByText(DEFAULT_LANDING.heroTitle)).toBeTruthy();
});

it('opens the editor with legacy settings and preserves the existing copy', () => {
  const { presentation: _newFields, ...oldConfig } = DEFAULT_LANDING;
  mockLoaded = { ...oldConfig, heroTitle: 'Titre déjà enregistré' } as LandingConfig;
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('01 · Hero'));
  expect(screen.getByLabelText('Titre principal').props.value).toBe('Titre déjà enregistré');
  expect(screen.getByLabelText('Image du hero · 4:3 recommandé : opacité de 0 à 100').props.value).toBe('0');
});

it('edits new media controls, preserves old content and saves the draft', async () => {
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('04 · Conclusion'));
  fireEvent.changeText(screen.getByLabelText('Fond de conclusion · paysage 16:9 recommandé : URL'), 'https://example.com/background.jpg');
  fireEvent.changeText(screen.getByLabelText('Fond de conclusion · paysage 16:9 recommandé : opacité de 0 à 100'), '42');
  fireEvent.press(screen.getByText("Enregistrer la page d'accueil"));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  const saved = mockSave.mock.calls[0][0];
  expect(saved.heroTitle).toBe(DEFAULT_LANDING.heroTitle);
  expect(saved.presentation.finalImage).toMatchObject({ url: 'https://example.com/background.jpg', opacity: 42 });
});

it('previews unsaved mobile copy without persisting it', () => {
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('01 · Hero'));
  fireEvent.changeText(screen.getByLabelText('Titre principal'), 'Un nouveau regard');
  fireEvent.press(screen.getByText('Aperçu site mobile'));
  expect(screen.getByText('Un nouveau regard')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it('previews the installed application with unsaved native copy', () => {
  render(<AdminLanding />);
  fireEvent.press(screen.getByText('Application'));
  fireEvent.changeText(screen.getByLabelText('Accroche (sous le nom)'), 'Mon accueil application');
  fireEvent.press(screen.getByText('Aperçu application installée'));
  expect(screen.getByText('Mon accueil application')).toBeTruthy();
  expect(screen.getByText(DEFAULT_LANDING.mobileCtaTitle)).toBeTruthy();
  expect(signalAppReady).not.toHaveBeenCalled();
  expect(screen.queryByText(DEFAULT_LANDING.heroTitle)).toBeNull();
  fireEvent.press(screen.getByText(DEFAULT_LANDING.mobileCtaPrimaryLabel));
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

it('falls back when an uploaded image cannot be loaded', () => {
  const { getByText, UNSAFE_getByType } = render(<LandingMedia media={{ ...DEFAULT_LANDING.presentation.productImage, url: 'https://example.com/missing.jpg' }} fallback={<React.Fragment><LandingPage previewConfig={DEFAULT_LANDING} previewWidth={390} /></React.Fragment>} />);
  fireEvent(UNSAFE_getByType(Image), 'error', { nativeEvent: { error: '404' } });
  expect(getByText(DEFAULT_LANDING.heroTitle)).toBeTruthy();
});
