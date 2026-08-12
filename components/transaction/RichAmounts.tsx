/**
 * RichAmounts — met en GRAS les montants d'un texte de recommandation.
 *
 * Les phrases sont construites côté moteur (chaînes simples, sans balisage). Plutôt que d'y injecter
 * du markup, on repère ici les montants (« 1 500 € », « ~63 594 € »…) et on les rend en gras. Le
 * séparateur de milliers de `toLocaleString('fr-FR')` est une espace insécable (U+00A0 / U+202F) →
 * incluse dans le motif.
 *
 * Partagé par le tableau de bord (RecoMessagesCarousel) et l'aperçu admin des recos
 * (RecommendationCard) : les deux affichent les mêmes phrases, ils doivent les rendre pareil.
 */
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';

const CURRENCY_RE = CURRENCY_SYMBOL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AMOUNT_RE = new RegExp(`(~?\\d[\\d\\s\\u00a0\\u202f.,]*\\s?${CURRENCY_RE})`, 'g');

export default function RichAmounts({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  // `split` avec un groupe capturant place les montants aux index IMPAIRS.
  const parts = text.split(AMOUNT_RE);
  return (
    <Text style={style}>
      {parts.map((p, i) => (i % 2 === 1 ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text> : p))}
    </Text>
  );
}
