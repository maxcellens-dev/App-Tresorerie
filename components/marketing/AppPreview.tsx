/**
 * L'APERÇU DE L'ACCUEIL, pour la vitrine (web et mobile) : le vrai rendu de l'app — le Relyka et sa
 * jauge, puis le plan de Pépin — sur une situation d'EXEMPLE (jamais de vraies données). Mêmes mots,
 * mêmes couleurs que l'accueil (CHOICE_LOOKS) : ce qu'on voit ici, c'est ce qu'on aura.
 */
import { View } from 'react-native';
import GardenText from '../garden/GardenText';
import GardenIcon from '../garden/GardenIcon';
import Pico from '../garden/Pico';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';

const PLAN = [['save', 710, 'vers ton livret'], ['invest', 1140, 'vers ton PEA'], ['keep', 300, 'reste sur ton compte'], ['enjoy', 710, 'pour te faire plaisir']] as const;
const eur = (n: number) => `${n.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

export default function AppPreview({ compact }: { compact?: boolean }) {
  return (
    <View style={{ gap: GARDEN_SPACE.md }} accessible accessibilityLabel="Exemple d'accueil Relyka : 2 860 euros à utiliser ce mois-ci, et le plan de Pépin pour les répartir">
      {/* Le Relyka et sa jauge */}
      <View style={{ backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg, gap: 6 }}>
        <GardenText variant="bodyStrong" color={G.inkSoft}>Ton Relyka</GardenText>
        <GardenText variant="amount" tabular style={{ fontSize: compact ? 40 : 48, lineHeight: compact ? 46 : 56 }}>{eur(2860)}</GardenText>
        <GardenText variant="small" color={G.inkSoft}>à utiliser d'ici la fin du mois, sans toucher à ta réserve.</GardenText>
        <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 3, marginTop: 6 }}>
          <View style={{ flex: 400, backgroundColor: G.fruits }} />
          <View style={{ flex: 1413, backgroundColor: G.water }} />
          <View style={{ flex: 2860, backgroundColor: G.primary }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          {([['Dépensé', eur(400), G.fruits], ['Prévu', eur(1413), G.water], ['Libre', eur(2860), G.primary]] as const).map(([l, v, c]) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
              <GardenText variant="smallStrong" color={G.inkSoft}>{l} {v}</GardenText>
            </View>
          ))}
        </View>
      </View>
      {/* Le plan de Pépin */}
      <View style={{ backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <Pico avatar size={40} mood="joy" />
          <View style={{ flex: 1 }}>
            <GardenText variant="heading">Le plan de Pépin</GardenText>
            <GardenText variant="small" color={G.inkSoft}>Voici comment je répartirais tes {eur(2860)}.</GardenText>
          </View>
        </View>
        {PLAN.slice(0, compact ? 2 : 4).map(([k, amount, sub]) => {
          const look = CHOICE_LOOKS[k];
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 4 }}>
              <GardenIcon icon={look.icon} fg={look.fg} bg={look.bg} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <GardenText variant="bodyStrong">{look.verb}</GardenText>
                <GardenText variant="small" color={G.muted} numberOfLines={1}>{sub}</GardenText>
              </View>
              <GardenText variant="bodyStrong" tabular color={look.fg}>{eur(amount)}</GardenText>
            </View>
          );
        })}
      </View>
    </View>
  );
}
