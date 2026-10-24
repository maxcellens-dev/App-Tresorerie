import React from 'react';
import { render, renderHook, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query';
import { DEFAULT_LANDING, useLandingConfig } from '../hooks/config/useLandingConfig';
import GardenLandingPage from '../components/marketing/GardenLandingPage';

jest.mock('../hooks/garden/useGardenFonts', () => ({ useGardenFonts: () => true }));
jest.mock('../hooks/garden/useGardenCosmetics', () => ({ useGardenCosmetics: () => ({ decor: [], outfit: {}, season: undefined }) }));
jest.mock('../hooks/theme/useBrandColors', () => ({ useBrandColors: () => ({ emerald: '#34D399', onAccent: '#123B37' }) }));
jest.mock('../hooks/theme/useBrandFont', () => ({ useAppNameFontStyle: () => ({}), APP_NAME_TEXT_PROPS: {} }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../hooks/data/useProfile', () => ({ useProfile: () => ({ data: null }) }));

function restoredCache(presentation?: unknown) {
  const options = { defaultOptions: { queries: { retry: false, gcTime: Infinity } } } as const;
  const previous = new QueryClient(options);
  const { presentation: _newFields, ...oldConfig } = DEFAULT_LANDING;
  previous.setQueryData(['landing_config'], { ...oldConfig, heroTitle: 'Mon accueil personnalisé', ...(presentation === undefined ? {} : { presentation }) });
  const client = new QueryClient(options);
  hydrate(client, dehydrate(previous));
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

it('normalizes a restored pre-redesign cache before any network request', () => {
  const { wrapper } = restoredCache();
  const { result } = renderHook(() => useLandingConfig(), { wrapper });
  expect(result.current.data?.heroTitle).toBe('Mon accueil personnalisé');
  expect(result.current.data?.presentation?.heroMedia).toEqual(DEFAULT_LANDING.presentation.heroMedia);
});

it('renders the public garden showcase immediately from the legacy cache', () => {
  const { wrapper } = restoredCache();
  render(<GardenLandingPage previewWidth={390} />, { wrapper });
  expect(screen.getByText('Sache ce que tu peux vraiment dépenser.')).toBeTruthy();
  expect(screen.getAllByText(DEFAULT_LANDING.brandName).length).toBeGreaterThan(0);
});

it('fills partially cached presentation settings without replacing uploaded images', () => {
  const { wrapper } = restoredCache({ finalImage: { url: 'https://example.com/custom.jpg', opacity: 0 } });
  const { result } = renderHook(() => useLandingConfig(), { wrapper });
  expect(result.current.data?.presentation?.heroMedia).toEqual(DEFAULT_LANDING.presentation.heroMedia);
  expect(result.current.data?.presentation?.finalImage).toMatchObject({ url: 'https://example.com/custom.jpg', opacity: 0, fit: 'cover' });
});
