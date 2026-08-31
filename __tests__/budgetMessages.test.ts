import { composeBudgetMessage, buildRelykaMessages } from '../lib/finance/recoMessages';

/* Le budget ne modifie AUCUN montant de l'app : il ne fait que se dire. Ce fichier verrouille donc
   deux choses — ce qu'il dit, et le fait qu'il ne le dise qu'une fois, en dernier. */

describe('composeBudgetMessage — un message, ou rien', () => {
  it('se tait sans budget', () => {
    expect(composeBudgetMessage({ budget: 0, spent: 400, pace: 200, envelope: 1000 })).toBeNull();
  });

  it('se tait quand rien n’est encore dépensé et que rien ne cloche', () => {
    expect(composeBudgetMessage({ budget: 1000, spent: 0, pace: null, envelope: 1000 })).toBeNull();
  });

  it('le DÉPASSEMENT constaté prime sur tout le reste', () => {
    const msg = composeBudgetMessage({ budget: 400, spent: 470, pace: 300, envelope: 200 });
    expect(msg).toContain('dépassé');
    // Le montant du dépassement, pas seulement le fait qu'il y en ait un.
    expect(msg).toContain('70');
    // Il prime : ni le rythme ni l'écart avec les habitudes ne s'expriment en même temps.
    expect(msg).not.toContain('À ce rythme');
    expect(msg).not.toContain('en dessous');
  });

  /* Le TON se teste sur ce qu'on s'interdit, pas sur une tournure précise — sinon le test casse au
     premier ajustement de rédaction, comme il l'a fait. Ce qui doit rester vrai : un dépassement de
     budget est une information, jamais un reproche ni une consigne. */
  it('ne culpabilise pas et ne donne pas d’ordre', () => {
    const msgs = [
      composeBudgetMessage({ budget: 400, spent: 470, pace: 300, envelope: 200 }),
      composeBudgetMessage({ budget: 1000, spent: 300, pace: 130, envelope: 1000 }),
      composeBudgetMessage({ budget: 800, spent: 100, pace: null, envelope: 1000 }),
    ].join(' ').toLowerCase();
    for (const banned of ['attention', 'tu dois', 'il faut', 'trop', 'erreur', 'échec', 'mauvais', '!']) {
      expect(msgs).not.toContain(banned);
    }
  });

  it('le RYTHME ne parle qu’au-delà de 115 %', () => {
    expect(composeBudgetMessage({ budget: 1000, spent: 300, pace: 110, envelope: 1000 })).not.toContain('À ce rythme');
    expect(composeBudgetMessage({ budget: 1000, spent: 300, pace: 130, envelope: 1000 })).toContain('À ce rythme');
  });

  it('le rythme reste MUET tant qu’il est trop tôt (pace null avant 25 % du mois)', () => {
    const msg = composeBudgetMessage({ budget: 1000, spent: 80, pace: null, envelope: 1000 });
    expect(msg).not.toContain('À ce rythme');
  });

  it('l’ÉCART budget/habitudes est présenté comme un objectif, pas comme une erreur', () => {
    const msg = composeBudgetMessage({ budget: 800, spent: 100, pace: null, envelope: 1000 });
    expect(msg).toContain('200');
    expect(msg).toContain('en dessous de ce que tu dépenses d\'habitude');
  });

  it('ne signale pas un écart négligeable (moins de 5 %)', () => {
    const msg = composeBudgetMessage({ budget: 990, spent: 100, pace: null, envelope: 1000 });
    expect(msg).not.toContain('en dessous');
  });

  it('à défaut, il rend simplement compte — dépensé, budget, reste', () => {
    const msg = composeBudgetMessage({ budget: 800, spent: 620, pace: 100, envelope: 800 });
    expect(msg).toContain('620');
    expect(msg).toContain('800');
    expect(msg).toContain('180');
  });
});

describe('buildRelykaMessages — le budget parle en dernier, et jamais en alerte', () => {
  const base = { baseMessage: 'Voilà ton Relyka.', baseIsGeneric: false, relykaColor: '#0f0', warnColor: '#fa0' };

  it('n’ajoute rien quand il n’y a pas de message budget', () => {
    const msgs = buildRelykaMessages({ ...base, budgetMessage: null });
    expect(msgs.find((m) => m.key === 'relyka:budget')).toBeUndefined();
  });

  it('le place APRÈS le garde-fou et le point bas — ce qui est urgent passe devant', () => {
    const msgs = buildRelykaMessages({
      ...base,
      guardMessage: 'Attention à ta marge.',
      troughMessage: 'Point bas le 24.',
      budgetMessage: 'Tu as dépensé 620 € sur 800 €.',
    });
    const keys = msgs.map((m) => m.key);
    expect(keys.indexOf('relyka:budget')).toBeGreaterThan(keys.indexOf('relyka:guard'));
    expect(keys.indexOf('relyka:budget')).toBeGreaterThan(keys.indexOf('relyka:trough'));
    expect(keys[keys.length - 1]).toBe('relyka:budget');
  });

  it('reste en ton « info » : un dépassement de budget n’est pas une mise en garde', () => {
    const msgs = buildRelykaMessages({ ...base, budgetMessage: 'Ton budget est dépassé de 47 €.' });
    const b = msgs.find((m) => m.key === 'relyka:budget');
    expect(b?.tone).toBe('info');
    expect(b?.color).toBe(base.relykaColor);
  });

  it('un seul message budget par carrousel', () => {
    const msgs = buildRelykaMessages({ ...base, budgetMessage: 'Tu as dépensé 620 € sur 800 €.' });
    expect(msgs.filter((m) => m.key === 'relyka:budget')).toHaveLength(1);
  });
});
