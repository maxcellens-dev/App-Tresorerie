/**
 * VERROU SYNCHRONE contre la double soumission.
 *
 * ── POURQUOI UN `useRef` ET PAS UN `useState` ───────────────────────────────────────────────────
 * Le réflexe est d'écrire `const [saving, setSaving] = useState(false)` puis
 * `disabled={saving}`. Mais `setSaving(true)` ne prend effet qu'au RENDU SUIVANT : entre le premier
 * tap et ce rendu, un second tap trouve encore `saving === false` et `disabled={false}`. Les deux
 * passent.
 *
 * Ce n'est pas théorique dans cette app — le constat est déjà écrit dans l'écran de saisie d'une
 * dépense partagée : « Deux taps rapprochés sur Enregistrer passaient donc tous les deux, et
 * lançaient deux enregistrements — donc deux transactions sur le compte. »
 *
 * Une référence, elle, est posée IMMÉDIATEMENT, dans le même tour de boucle d'événements.
 *
 * ── OÙ C'EST INDISPENSABLE ──────────────────────────────────────────────────────────────────────
 * Partout où l'action n'est pas IDEMPOTENTE, c'est-à-dire où la rejouer crée quelque chose de plus :
 * saisir une transaction, poser une régularisation, enregistrer une plus-value, faire un virement
 * (deux écritures liées), cumuler un montant. Un simple « mettre à jour un réglage » n'en a pas
 * besoin : le rejouer écrit la même valeur.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
 *     const submit = useSubmitLock();
 *     async function onSave() {
 *       if (!submit.acquire()) return;      // un envoi est déjà parti
 *       try { await mutation.mutateAsync(...); }
 *       finally { submit.release(); }       // toujours libérer, succès comme échec
 *     }
 *
 * `release()` dans un `finally` : sans lui, un échec réseau laisserait le bouton muet à vie.
 */
import { useCallback, useRef } from 'react';

export interface SubmitLock {
  /** `true` si l'on a le droit de partir ; `false` si un envoi est déjà en cours. */
  acquire: () => boolean;
  /** À appeler dans un `finally`, y compris en cas d'échec. */
  release: () => void;
  /** Lecture seule — utile pour un rendu (mais ne remplace jamais `acquire`). */
  isBusy: () => boolean;
}

export function useSubmitLock(): SubmitLock {
  const busy = useRef(false);

  const acquire = useCallback(() => {
    if (busy.current) return false;
    busy.current = true;
    return true;
  }, []);

  const release = useCallback(() => { busy.current = false; }, []);
  const isBusy = useCallback(() => busy.current, []);

  return { acquire, release, isBusy };
}
