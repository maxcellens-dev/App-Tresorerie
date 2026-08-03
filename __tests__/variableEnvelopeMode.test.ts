/**
 * Référence des dépenses variables — la règle exacte du mode « auto ».
 *
 * Reproduit la décision prise dans usePilotageData (computePilotageData) : le mode ne dépend QUE du
 * nombre de mois passés exploitables et du choix de l'utilisateur. Ce test fige la réponse à
 * « pendant combien de temps l'auto reste-t-il sur l'estimation ? ».
 */
type Mode = 'auto' | 'estimate' | 'real';

function resolveEnvelope(input: {
  mode: Mode;
  /** Mois PASSÉS exploitables : dépenses variables > 0 ET mois non « estimated ». */
  usableMonths: number;
  estimateValue: number;
  realValue: number;
}): { value: number; source: 'history' | 'onboarding' | 'none' } {
  const realAvailable = input.usableMonths >= 2;
  const useReal = realAvailable && input.mode !== 'estimate';
  if (useReal) return { value: input.realValue, source: 'history' };
  if (input.estimateValue > 0) return { value: input.estimateValue, source: 'onboarding' };
  if (realAvailable) return { value: input.realValue, source: 'history' };
  return { value: 0, source: 'none' };
}

const base = { estimateValue: 400, realValue: 520 };

describe('mode « auto » — bascule estimation → calculé', () => {
  it('mois 1 et 2 : l’auto s’en tient à l’ESTIMATION (aucun mois complet derrière soi)', () => {
    expect(resolveEnvelope({ ...base, mode: 'auto', usableMonths: 0 })).toEqual({ value: 400, source: 'onboarding' });
    expect(resolveEnvelope({ ...base, mode: 'auto', usableMonths: 1 })).toEqual({ value: 400, source: 'onboarding' });
  });

  it('à partir du 3ᵉ mois (2 mois passés exploitables) : l’auto passe au CALCULÉ', () => {
    expect(resolveEnvelope({ ...base, mode: 'auto', usableMonths: 2 })).toEqual({ value: 520, source: 'history' });
    expect(resolveEnvelope({ ...base, mode: 'auto', usableMonths: 6 })).toEqual({ value: 520, source: 'history' });
  });
});

describe('modes forcés', () => {
  it('« estimation » reste sur le déclaré, même avec de l’historique', () => {
    expect(resolveEnvelope({ ...base, mode: 'estimate', usableMonths: 6 })).toEqual({ value: 400, source: 'onboarding' });
  });

  it('« calculé » sans historique suffisant retombe sur l’estimation (pas de moyenne sur 1 mois)', () => {
    expect(resolveEnvelope({ ...base, mode: 'real', usableMonths: 1 })).toEqual({ value: 400, source: 'onboarding' });
  });

  it('« estimation » sans rien de déclaré prend le calculé plutôt que rien', () => {
    expect(resolveEnvelope({ ...base, estimateValue: 0, mode: 'estimate', usableMonths: 4 }))
      .toEqual({ value: 520, source: 'history' });
  });

  it('ni déclaré ni historique → aucune enveloppe (on n’invente pas)', () => {
    expect(resolveEnvelope({ estimateValue: 0, realValue: 0, mode: 'auto', usableMonths: 0 }))
      .toEqual({ value: 0, source: 'none' });
  });
});
