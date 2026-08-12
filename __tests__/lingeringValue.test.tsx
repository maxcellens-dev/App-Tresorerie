import { renderHook, act } from '@testing-library/react-native';
import { useLingeringValue } from '../hooks/platform/useLingeringValue';

/**
 * Verrou sur le « reste de modale » vu sur web.
 *
 * Le premier correctif mémorisait la valeur dans un `useEffect` — donc APRÈS le premier rendu — et
 * laissait passer une image de carte vide à l'ouverture, ce qui aggravait le défaut. Le premier
 * test ci-dessous est précisément celui qui aurait attrapé cette erreur.
 */
describe('useLingeringValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rend la valeur DÈS LE PREMIER RENDU à l\'ouverture — aucune image vide', () => {
    const { result, rerender } = renderHook<string | null, { v: string | null }>(({ v }) => useLingeringValue(v, 300), {
      initialProps: { v: null as string | null },
    });
    expect(result.current).toBeNull();

    rerender({ v: 'spent' });
    // Aucun timer avancé, aucun effet joué : la valeur est là immédiatement.
    expect(result.current).toBe('spent');
  });

  it('conserve la valeur pendant le fondu de sortie', () => {
    const { result, rerender } = renderHook<string | null, { v: string | null }>(({ v }) => useLingeringValue(v, 300), {
      initialProps: { v: 'spent' as string | null },
    });
    rerender({ v: null });
    expect(result.current).toBe('spent');       // encore là : la modale s'efface
    act(() => { jest.advanceTimersByTime(299); });
    expect(result.current).toBe('spent');
  });

  it('oublie la valeur une fois l\'animation terminée', () => {
    const { result, rerender } = renderHook<string | null, { v: string | null }>(({ v }) => useLingeringValue(v, 300), {
      initialProps: { v: 'spent' as string | null },
    });
    rerender({ v: null });
    act(() => { jest.advanceTimersByTime(300); });
    expect(result.current).toBeNull();
  });

  it('suit un changement de vue sans passer par le vide', () => {
    const { result, rerender } = renderHook<string | null, { v: string | null }>(({ v }) => useLingeringValue(v, 300), {
      initialProps: { v: 'spent' as string | null },
    });
    rerender({ v: 'relyka' });
    expect(result.current).toBe('relyka');
  });

  it('annule l\'oubli si la modale est rouverte avant la fin du délai', () => {
    const { result, rerender } = renderHook<string | null, { v: string | null }>(({ v }) => useLingeringValue(v, 300), {
      initialProps: { v: 'spent' as string | null },
    });
    rerender({ v: null });
    act(() => { jest.advanceTimersByTime(200); });
    rerender({ v: 'spent' });
    act(() => { jest.advanceTimersByTime(500); });
    expect(result.current).toBe('spent'); // le timer d'oubli a bien été annulé
  });
});
