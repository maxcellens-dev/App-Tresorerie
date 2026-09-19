jest.mock('../lib/platform/supabase', () => ({ supabase: null }));
jest.mock('../lib/platform/themeBoot', () => ({ setCachedAdminTheme: jest.fn() }));
import { mergeLanding, DEFAULT_LANDING } from '../hooks/config/useLandingConfig';

describe('landing configuration compatibility', () => {
  it('keeps existing copy and image while supplying the new presentation', () => {
    const cfg = mergeLanding({ heroTitle: 'Mon titre', heroImage: 'https://example.com/hero.jpg' });
    expect(cfg.heroTitle).toBe('Mon titre');
    expect(cfg.heroImage).toBe('https://example.com/hero.jpg');
    expect(cfg.presentation.productImage.url).toBe('');
    expect(cfg.presentation.previewLabel).toBeTruthy();
  });
  it('preserves partial media settings and fills missing fields', () => {
    const cfg = mergeLanding({ presentation: { finalImage: { url: 'https://example.com/bg.jpg', opacity: 0 } } } as any);
    expect(cfg.presentation.finalImage.url).toBe('https://example.com/bg.jpg');
    expect(cfg.presentation.finalImage.opacity).toBe(0);
    expect(cfg.presentation.finalImage.overlay).toBe(DEFAULT_LANDING.presentation.finalImage.overlay);
    expect(cfg.presentation.productImage).toEqual(DEFAULT_LANDING.presentation.productImage);
  });
  it('allows intentionally empty sections', () => {
    expect(mergeLanding({ features: [], stats: [] }).features).toEqual([]);
    expect(mergeLanding({ features: [], stats: [] }).stats).toEqual([]);
  });
});
