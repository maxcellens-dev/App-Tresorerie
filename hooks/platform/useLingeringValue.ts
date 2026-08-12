import { useState, useEffect } from 'react';

/**
 * Garde la dernière valeur NON NULLE le temps qu'une modale finisse son fondu de sortie.
 *
 * ── Le défaut que ça corrige ───────────────────────────────────────────────────────────────────
 * Sur react-native-web, `Modal` garde sa boîte montée pendant les fondus d'ENTRÉE et de SORTIE.
 * Une modale dont le contenu est conditionné par le même état que `visible` — le motif
 * `visible={!!x}` avec `{x && …}` — montre donc une carte VIDE pendant ces deux animations :
 * le fameux « reste de modale » qu'on voit un instant en fermant.
 *
 * ── Pourquoi PAS un `useEffect` ────────────────────────────────────────────────────────────────
 * Un effet s'exécute APRÈS le premier rendu. Mémoriser la valeur là laisse passer une image de
 * carte vide À L'OUVERTURE — ce qui aggrave le défaut au lieu de le corriger (erreur commise).
 * L'ajustement se fait donc PENDANT le rendu (motif React « adjusting state on prop change ») :
 * React relance le rendu immédiatement, sans jamais peindre l'état intermédiaire.
 *
 * L'effet ne sert qu'à l'oubli différé, une fois l'animation finie — là, le délai est voulu.
 */
export function useLingeringValue<T>(value: T | null | undefined, ms = 300): T | null {
  const [last, setLast] = useState<T | null>(value ?? null);

  // Synchrone : à l'ouverture, le contenu est présent dès le PREMIER rendu.
  if (value != null && value !== last) setLast(value);

  useEffect(() => {
    if (value != null) return;
    const t = setTimeout(() => setLast(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);

  return value ?? last;
}
