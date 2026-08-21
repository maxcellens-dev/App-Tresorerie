/**
 * Le verrou anti-double-soumission, et la saisie d'un TAUX.
 *
 * Ces deux-là protègent le même point faible : ce que l'utilisateur croit avoir enregistré doit être
 * ce qui part réellement en base. Le verrou empêche que ça parte DEUX fois ; l'assainissement
 * empêche que ça parte AVEC UNE AUTRE VALEUR.
 */
import { sanitizeAmountInput, sanitizeRateInput, parseAmountInput } from '../lib/ui/amountInput';

/* Reproduction de `useSubmitLock` hors de React : le verrou n'est qu'une référence mutable, sa
   logique ne dépend pas du rendu. C'est justement ce qui le rend fiable — on la teste telle quelle. */
function makeLock() {
  let busy = false;
  return {
    acquire: () => { if (busy) return false; busy = true; return true; },
    release: () => { busy = false; },
    isBusy: () => busy,
  };
}

describe('verrou de soumission', () => {
  it('laisse passer le premier appel et refuse le second', () => {
    const lock = makeLock();
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false);
  });

  it('rouvre après release — un échec réseau ne doit pas condamner le bouton', () => {
    const lock = makeLock();
    lock.acquire();
    lock.release();
    expect(lock.acquire()).toBe(true);
  });

  it('bloque deux taps partis dans le MÊME tour de boucle (le cas que useState rate)', async () => {
    const lock = makeLock();
    const writes: number[] = [];
    // `submit` reproduit un vrai gestionnaire : synchrone jusqu'au premier await, comme handleSubmit.
    const submit = async () => {
      if (!lock.acquire()) return;
      try { await Promise.resolve(); writes.push(1); }
      finally { lock.release(); }
    };
    // Les deux taps sont déclenchés sans laisser React re-rendre entre les deux.
    await Promise.all([submit(), submit()]);
    expect(writes).toHaveLength(1); // une seule écriture, pas deux
  });

  it('autorise une nouvelle soumission une fois la précédente terminée', async () => {
    const lock = makeLock();
    const writes: number[] = [];
    const submit = async () => {
      if (!lock.acquire()) return;
      try { await Promise.resolve(); writes.push(1); }
      finally { lock.release(); }
    };
    await submit();
    await submit();
    expect(writes).toHaveLength(2);
  });
});

describe('saisie d’un taux', () => {
  it('garde trois décimales — 1,125 % est un taux réel', () => {
    expect(sanitizeRateInput('1,125')).toBe('1,125');
    expect(parseAmountInput(sanitizeRateInput('1,125'))).toBe(1.125);
  });

  it('tronque au-delà de trois décimales', () => {
    expect(sanitizeRateInput('2,9999')).toBe('2,999');
  });

  it('refuse toujours le second séparateur', () => {
    expect(sanitizeRateInput('1.2.3')).toBe('1.23');
  });

  it('un montant reste à deux décimales', () => {
    expect(sanitizeAmountInput('1,125')).toBe('1,12');
  });

  /* LA garantie du module : ce qui est AFFICHÉ est exactement ce qui sera LU.
     L'assainisseur ne devine pas l'intention — il ne décide pas qu'un point est un séparateur de
     milliers (« 3.50 » voudrait dire 3,50 pour beaucoup, « 200.000 » deux cent mille pour d'autres :
     trancher, c'est se tromper une fois sur deux, en silence). Il rend la coupure VISIBLE pendant la
     frappe, pour que l'utilisateur la corrige lui-même.
     Avant, le champ montrait « 200.000 » et enregistrait 200 sans rien dire. */
  it.each([
    ['200.000', '200.00'],
    ['1.234,56', '1.23'],
    ['200 000', '200000'],   // l'espace de milliers, lui, est sans ambiguïté : retiré
    ['10000', '10000'],
    ['12,5', '12,5'],
  ])('affiché = lu : « %s » devient « %s »', (typed, shown) => {
    expect(sanitizeAmountInput(typed)).toBe(shown);
    // et la lecture retombe très exactement sur ce que le champ montre
    expect(parseAmountInput(shown)).toBe(parseFloat(shown.replace(',', '.')));
  });

  it('maxDecimals=0 ne laisse aucune décimale', () => {
    expect(sanitizeAmountInput('12,99', 0)).toBe('12,');
  });
});
