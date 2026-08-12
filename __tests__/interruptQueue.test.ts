import {
  setInterruptPending, currentInterrupt, canShowInterrupt, resetInterrupts, INTERRUPT_ORDER,
} from '../lib/engagement/interruptQueue';

/**
 * À l'ouverture après quelques jours d'absence, plusieurs choses veulent parler en même temps.
 * Ce test fige QUI parle en premier — et surtout, qu'une seule parle à la fois.
 */
beforeEach(() => resetInterrupts());

describe('file d’attente des sollicitations', () => {
  it('personne n’attend → personne ne parle', () => {
    expect(currentInterrupt()).toBeNull();
  });

  it('la clôture passe avant tout le reste', () => {
    setInterruptPending('achievement', true);
    setInterruptPending('profile_change', true);
    setInterruptPending('pulse_month', true);
    setInterruptPending('closure', true);
    expect(currentInterrupt()).toBe('closure');
    expect(canShowInterrupt('pulse_month')).toBe(false);
    expect(canShowInterrupt('achievement')).toBe(false);
  });

  it('l’ordre complet : clôture → bilan du mois → profil → succès → « +1 » de la série', () => {
    expect(INTERRUPT_ORDER).toEqual(['closure', 'pulse_month', 'profile_change', 'achievement', 'streak_bump']);
  });

  it('le « +1 » de la flamme passe toujours EN DERNIER', () => {
    // C'est une animation, pas une information : elle attend que toutes les fenêtres soient closes.
    setInterruptPending('streak_bump', true);
    setInterruptPending('achievement', true);
    setInterruptPending('closure', true);
    expect(canShowInterrupt('streak_bump')).toBe(false);
    setInterruptPending('closure', false);
    expect(canShowInterrupt('streak_bump')).toBe(false);   // les succès parlent encore
    setInterruptPending('achievement', false);
    expect(currentInterrupt()).toBe('streak_bump');        // à elle, enfin
  });

  it('la suivante ne prend la main qu’une fois la précédente TRAITÉE', () => {
    setInterruptPending('closure', true);
    setInterruptPending('pulse_month', true);
    setInterruptPending('achievement', true);
    expect(currentInterrupt()).toBe('closure');

    setInterruptPending('closure', false);              // clôture faite
    expect(currentInterrupt()).toBe('pulse_month');

    setInterruptPending('pulse_month', false);          // bilan lu
    expect(currentInterrupt()).toBe('achievement');     // le profil n'attendait pas
  });

  it('les succès ne passent jamais devant le profil', () => {
    setInterruptPending('achievement', true);
    setInterruptPending('profile_change', true);
    expect(currentInterrupt()).toBe('profile_change');
  });

  it('les abonnés sont prévenus à chaque changement', () => {
    const seen: (string | null)[] = [];
    const { subscribeInterrupts } = require('../lib/engagement/interruptQueue');
    const off = subscribeInterrupts(() => seen.push(currentInterrupt()));
    setInterruptPending('achievement', true);
    setInterruptPending('closure', true);
    setInterruptPending('closure', false);
    off();
    setInterruptPending('achievement', false);          // plus abonné → rien de plus
    expect(seen).toEqual(['achievement', 'closure', 'achievement']);
  });
});
