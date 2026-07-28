import {
  nextProgressiveQuestion,
  profileStillProvisional,
  PROGRESSIVE_ORDER,
  PROGRESSIVE_QUESTIONS,
  type ProgressiveState,
} from '../lib/progressiveProfile';
import {
  computeInitialProfile,
  q5FromSecurityMonths,
  deriveQ5,
  q3FromMonthlyIncome,
  NEUTRAL_ANSWERS,
  Q4_OPTIONS,
  Q5_OPTIONS,
  Q3_OPTIONS,
} from '../lib/financialProfileEngine';

const base: ProgressiveState = {
  socleDone: true,
  events: { any: 0, relyka: 0, comptes: 0, tx: 0 },
  answered: {},
  snoozed: {},
};

describe('progressiveProfile — quand poser une question', () => {
  it('ne pose rien tant que le socle de démarrage n’est pas terminé', () => {
    expect(nextProgressiveQuestion({ ...base, socleDone: false, events: { ...base.events, any: 10 } })).toBeNull();
  });

  it('ne pose rien avant la première interaction', () => {
    expect(nextProgressiveQuestion(base)).toBeNull();
  });

  it('pose q4 (profil) dès la première interaction', () => {
    const pick = nextProgressiveQuestion({ ...base, events: { ...base.events, any: 1 } });
    expect(pick?.question.key).toBe('q4');
    expect(pick?.step).toBe(1);
    expect(pick?.total).toBe(PROGRESSIVE_ORDER.length);
  });

  it('enchaîne sur q6 à l’interaction suivante — pas de quota journalier', () => {
    const pick = nextProgressiveQuestion({
      ...base,
      events: { ...base.events, any: 2 },
      answered: { q4: true },
    });
    expect(pick?.question.key).toBe('q6');
  });

  it('ouvre q8 dès l’ouverture du détail du Relyka, sans attendre le seuil générique', () => {
    const pick = nextProgressiveQuestion({
      ...base,
      events: { any: 1, relyka: 1, comptes: 0, tx: 0 },
      answered: { q4: true, q6: true },
    });
    expect(pick?.question.key).toBe('q8');
  });

  it('ouvre q9 dès l’entrée dans les transactions', () => {
    const pick = nextProgressiveQuestion({
      ...base,
      events: { any: 1, relyka: 0, comptes: 0, tx: 1 },
      answered: { q4: true, q6: true, q8: true },
    });
    expect(pick?.question.key).toBe('q9');
  });

  it('ne repose jamais une question répondue ni une question reportée pour la session', () => {
    const state: ProgressiveState = {
      ...base,
      events: { ...base.events, any: 5 },
      answered: { q4: true },
      snoozed: { q6: true },
    };
    expect(nextProgressiveQuestion(state)?.question.key).toBe('q8');
  });

  it('n’a plus rien à poser une fois les quatre répondues', () => {
    const answered = Object.fromEntries(PROGRESSIVE_ORDER.map((k) => [k, true]));
    expect(nextProgressiveQuestion({ ...base, events: { ...base.events, any: 99 }, answered })).toBeNull();
  });
});

describe('progressiveProfile — profil provisoire', () => {
  it('reste provisoire tant qu’une question de PROFIL manque', () => {
    expect(profileStillProvisional({ q4: true })).toBe(true);
    expect(profileStillProvisional({ q6: true })).toBe(true);
  });

  it('n’est plus provisoire dès que q4 et q6 sont répondues, même sans q8/q9', () => {
    expect(profileStillProvisional({ q4: true, q6: true })).toBe(false);
  });

  it('les questions de précision (q8, q9) n’affectent pas le profil', () => {
    expect(PROGRESSIVE_QUESTIONS.q8.affectsProfile).toBe(false);
    expect(PROGRESSIVE_QUESTIONS.q9.affectsProfile).toBe(false);
  });

  it('« je ne sais pas » enregistre une VRAIE réponse (la question cesse de revenir)', () => {
    // q4 : surtout pas la 1ʳᵉ option (« découvert »), qui vaut P1 d'office.
    expect(PROGRESSIVE_QUESTIONS.q4.unknownValue).toBe(Q4_OPTIONS[1]);
    expect(PROGRESSIVE_QUESTIONS.q4.unknownValue).not.toBe(Q4_OPTIONS[0]);
  });
});

describe('financialProfileEngine — q5 mesurée au lieu d’être déclarée', () => {
  it('convertit un nombre de mois de sécurité en tranche Q5', () => {
    expect(q5FromSecurityMonths(0)).toBe(Q5_OPTIONS[0]);
    expect(q5FromSecurityMonths(0.9)).toBe(Q5_OPTIONS[0]);
    expect(q5FromSecurityMonths(1)).toBe(Q5_OPTIONS[1]);
    expect(q5FromSecurityMonths(2.9)).toBe(Q5_OPTIONS[1]);
    expect(q5FromSecurityMonths(3)).toBe(Q5_OPTIONS[2]);
    expect(q5FromSecurityMonths(6)).toBe(Q5_OPTIONS[3]);
    expect(q5FromSecurityMonths(null)).toBe(Q5_OPTIONS[0]);
  });

  it('déduit la tranche depuis l’épargne et le revenu réels', () => {
    expect(deriveQ5(9000, 1800)).toBe(Q5_OPTIONS[2]);   // 5 mois couverts → « 3 à 6 mois »
    expect(deriveQ5(12000, 1800)).toBe(Q5_OPTIONS[3]);  // 6,7 mois → « Plus de 6 mois »
    expect(deriveQ5(900, 1800)).toBe(Q5_OPTIONS[0]);    // 0,5 mois → « Moins d'un mois »
  });

  it('sans revenu connu, ne prétend pas connaître le matelas', () => {
    expect(deriveQ5(5000, 0)).toBe(Q5_OPTIONS[0]);
  });

  it('convertit un revenu mensuel en tranche Q3', () => {
    expect(q3FromMonthlyIncome(1200)).toBe(Q3_OPTIONS[0]);
    expect(q3FromMonthlyIncome(1800)).toBe(Q3_OPTIONS[1]);
    expect(q3FromMonthlyIncome(3000)).toBe(Q3_OPTIONS[2]);
    expect(q3FromMonthlyIncome(5000)).toBe(Q3_OPTIONS[3]);
  });
});

describe('financialProfileEngine — les réponses neutres ne classent plus tout le monde en P1', () => {
  const withQ5 = (q5: string) =>
    computeInitialProfile({
      q1: '', q2: '', q3: '', q7: '', q8: '', q9: '',
      q4: NEUTRAL_ANSWERS.q4, q5, q6: NEUTRAL_ANSWERS.q6,
    });

  it('laisse la q5 MESURÉE décider du niveau', () => {
    expect(withQ5(Q5_OPTIONS[0])).toBe('P1');   // moins d'un mois
    expect(withQ5(Q5_OPTIONS[1])).toBe('P2');   // 1 à 3 mois
    expect(withQ5(Q5_OPTIONS[2])).toBe('P2');   // 3 à 6 mois, sans comportement d'épargne déclaré
    expect(withQ5(Q5_OPTIONS[3])).toBe('P4');   // plus de 6 mois
  });

  it('l’ancien repli « première option partout » forçait P1 quel que soit le matelas', () => {
    const oldFallback = (q5: string) =>
      computeInitialProfile({
        q1: '', q2: '', q3: '', q7: '', q8: '', q9: '',
        q4: Q4_OPTIONS[0], q5, q6: '0 %',
      });
    expect(oldFallback(Q5_OPTIONS[3])).toBe('P1');  // le bug : 6 mois d'épargne → « épargne critique »
    expect(withQ5(Q5_OPTIONS[3])).toBe('P4');       // corrigé
  });
});
