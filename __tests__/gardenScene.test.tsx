/**
 * L'arbre à l'écran : chaque partie dessinée est un bouton nommé (lecteur d'écran) qui renvoie la
 * bonne partie, et la scène sans gestionnaire n'est qu'une image décrite.
 */
import { fireEvent, render } from '@testing-library/react-native';
import GardenScene from '../components/garden/GardenScene';
import { computeTreeState } from '../lib/garden/treeState';

const camille = computeTreeState({
  currentBalance: 1653, minimumToKeep: 200, monthlyReference: 1900, securityMonths: 1.8,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 96,
  recurringInvestMonthly: 0, streakWeeks: 6,
  credits: [{ id: 'auto', kind: 'healthy', remaining: 4300, borrowed: 10000 }],
});

describe('GardenScene', () => {
  it('renvoie la partie touchée', () => {
    const onPressPart = jest.fn();
    const { getByLabelText } = render(<GardenScene state={camille} options={{ id: 't' }} onPressPart={onPressPart} />);
    fireEvent.press(getByLabelText('Arrosoir · Comptes courants'));
    fireEvent.press(getByLabelText('Cabane · Crédit'));
    fireEvent.press(getByLabelText('Racines · Épargne de secours'));
    expect(onPressPart.mock.calls.map((c) => c[0])).toEqual(['can', 'cabin', 'roots']);
  });

  it("sans gestionnaire, c'est une image décrite, sans bouton", () => {
    const { getByLabelText, queryByLabelText } = render(<GardenScene state={camille} options={{ id: 'u' }} />);
    expect(getByLabelText(/Un jeune arbre, racines à 1,8 mois/)).toBeTruthy();
    expect(queryByLabelText('Arrosoir · Comptes courants')).toBeNull();
  });
});
