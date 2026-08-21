/**
 * Saisie d'un montant — le champ ne doit JAMAIS afficher autre chose que ce qui sera lu.
 *
 * Les champs se contentaient de retirer les caractères non numériques, ce qui laissait passer
 * plusieurs séparateurs. Or tous les lecteurs font `parseFloat(x.replace(',', '.'))`, et `replace`
 * avec une chaîne ne remplace que la PREMIÈRE occurrence : taper « 1.234,56 » affichait
 * « 1.234,56 » et enregistrait **1,23 €**, sans le moindre signal.
 */
import { sanitizeAmountInput, sanitizeSignedAmountInput, parseAmountInput } from '../lib/ui/amountInput';

describe('sanitizeAmountInput', () => {
  it('laisse passer un entier', () => {
    expect(sanitizeAmountInput('1250')).toBe('1250');
  });

  it('conserve le séparateur tapé par l\'utilisateur', () => {
    expect(sanitizeAmountInput('12,5')).toBe('12,5');
    expect(sanitizeAmountInput('12.5')).toBe('12.5');
  });

  /* LE CAS QUI CASSAIT : « 1.234,56 » devient « 1.23 » — visible, donc corrigeable, au lieu d'être
     tronqué en silence à l'enregistrement. */
  it('refuse le SECOND séparateur', () => {
    expect(sanitizeAmountInput('1.234,56')).toBe('1.23');
    expect(sanitizeAmountInput('12,,5')).toBe('12,5');
    expect(sanitizeAmountInput('1,2,3')).toBe('1,23');
  });

  it('borne à deux décimales', () => {
    expect(sanitizeAmountInput('99,999')).toBe('99,99');
    expect(sanitizeAmountInput('7,123456')).toBe('7,12');
  });

  it('retire tout ce qui n\'est pas un chiffre ou un séparateur', () => {
    expect(sanitizeAmountInput('1 234,56')).toBe('1234,56');
    expect(sanitizeAmountInput('12 €')).toBe('12');
    expect(sanitizeAmountInput('abc')).toBe('');
    expect(sanitizeAmountInput('-50')).toBe('50'); // le signe passe par la variante signée
  });

  it('accepte les états intermédiaires de frappe', () => {
    expect(sanitizeAmountInput('')).toBe('');
    expect(sanitizeAmountInput('7.')).toBe('7.');   // l'utilisateur va taper ses décimales
    expect(sanitizeAmountInput(',')).toBe(',');
  });

  it('ne lève pas sur une entrée nulle', () => {
    expect(sanitizeAmountInput(null as any)).toBe('');
    expect(sanitizeAmountInput(undefined as any)).toBe('');
  });
});

describe('sanitizeSignedAmountInput — soldes qui peuvent être négatifs', () => {
  it('garde le signe en tête', () => {
    expect(sanitizeSignedAmountInput('-120,50')).toBe('-120,50');
  });

  it('applique les mêmes règles au reste', () => {
    expect(sanitizeSignedAmountInput('-1.234,56')).toBe('-1.23');
  });

  it('ignore un signe ailleurs qu\'en tête', () => {
    expect(sanitizeSignedAmountInput('12-5')).toBe('125');
  });

  it('laisse un montant positif intact', () => {
    expect(sanitizeSignedAmountInput('300')).toBe('300');
  });
});

describe('parseAmountInput', () => {
  it('lit les deux séparateurs', () => {
    expect(parseAmountInput('12,5')).toBe(12.5);
    expect(parseAmountInput('12.5')).toBe(12.5);
    expect(parseAmountInput('-120,50')).toBe(-120.5);
  });

  it('rend null quand le champ ne dit rien d\'exploitable', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('   ')).toBeNull();
    expect(parseAmountInput(null)).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });

  /* La garantie qui compte : après passage par le filtre de saisie, ce que le champ MONTRE et ce
     que le lecteur COMPREND sont le même nombre. */
  it('ce qui est affiché est exactement ce qui est lu', () => {
    for (const frappe of ['1.234,56', '12,,5', '99,999', '1 234,56', '7,12']) {
      const affiche = sanitizeAmountInput(frappe);
      expect(parseAmountInput(affiche)).toBe(parseFloat(affiche.replace(',', '.')));
    }
  });
});
