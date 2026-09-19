import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useBodyFontStyle } from '../hooks/theme/useBrandFont';

let mockStyle: { font_family: string; custom_fonts: { family: string; url: string }[] };
let mockReady = false;
const mockLoad = jest.fn();
jest.mock('../hooks/theme/useStyleConfig', () => ({ useStyleConfig: () => ({ data: mockStyle }) }));
jest.mock('../lib/platform/nativeFonts', () => ({
  useNativeFontsVersion: () => 0,
  isNativeFontReady: () => mockReady,
  ensureNativeFonts: (...args: unknown[]) => mockLoad(...args),
}));

beforeEach(() => {
  mockStyle = { font_family: 'Editorial', custom_fonts: [{ family: 'Editorial', url: 'https://example.com/font.ttf' }] };
  mockReady = false;
  mockLoad.mockClear();
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => jest.restoreAllMocks());

it('keeps the system fallback until the centrally selected font is loaded', () => {
  const { result, rerender } = renderHook(() => useBodyFontStyle());
  expect(result.current).toEqual({});
  expect(mockLoad).toHaveBeenCalledWith(mockStyle.custom_fonts);
  mockReady = true;
  rerender({});
  expect(result.current).toEqual({ fontFamily: 'Editorial', fontWeight: 'normal' });
});

it('follows a central font change back to System', () => {
  mockReady = true;
  const { result, rerender } = renderHook(() => useBodyFontStyle());
  mockStyle = { font_family: 'System', custom_fonts: mockStyle.custom_fonts };
  rerender({});
  expect(result.current).toEqual({});
});

it('leaves the web font under the existing global CSS control', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  mockReady = true;
  const { result } = renderHook(() => useBodyFontStyle());
  expect(result.current).toEqual({});
  expect(mockLoad).not.toHaveBeenCalled();
});
