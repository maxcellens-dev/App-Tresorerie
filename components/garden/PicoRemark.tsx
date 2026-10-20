/**
 * Une remarque de Pico (messages du moteur actuel : buildRelykaMessages / buildRecoMessages).
 *
 * Chaque remarque prend la COULEUR de la partie de l'arbre dont elle parle (épargner = racines,
 * investir = branches, plaisir = fleurs, garder = eau) : la page se lit d'un coup d'œil au lieu
 * d'une pile de cartes blanches. Les montants ressortent en gras, et le conseil (« 💡 … ») est
 * détaché du constat dans un encart à part.
 */
import { live } from '../../lib/garden/live';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenText from './GardenText';
import ChoiceIcon from './ChoiceIcon';
import type { RecoMessage } from '../../lib/finance/recoMessages';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';

interface Look { bg: string; fg: string; fill: string; icon: string }

const LOOKS: Record<string, Look> = live(() => ({
  save: { bg: G.rootsBg, fg: G.rootsText, fill: G.roots, icon: 'garden-roots' },
  invest: { bg: G.branchesBg, fg: G.branchesText, fill: G.branches, icon: 'trending-up-outline' },
  enjoy: { bg: G.flowersBg, fg: G.flowersText, fill: G.flowers, icon: 'flower-outline' },
  keep: { bg: G.waterBg, fg: G.waterText, fill: G.water, icon: 'water-outline' },
  trough: { bg: G.waterBg, fg: G.waterText, fill: G.water, icon: 'trending-down-outline' },
  budget: { bg: G.fruitsBg, fg: G.fruitsText, fill: G.fruits, icon: 'wallet-outline' },
  warn: { bg: G.notice, fg: G.noticeText, fill: G.roots, icon: 'alert-circle-outline' },
  main: { bg: G.branchesBg, fg: G.branchesText, fill: G.branches, icon: 'sparkles-outline' },
  info: { bg: G.pico, fg: G.picoText, fill: '#E9B872', icon: 'information-circle-outline' },
}));

function lookFor(m: RecoMessage): Look {
  if (m.recoType && LOOKS[m.recoType]) return LOOKS[m.recoType];
  if (m.tone === 'warn') return LOOKS.warn;
  if (m.key === 'relyka:trough') return LOOKS.trough;
  if (m.key === 'relyka:budget') return LOOKS.budget;
  if (m.key === 'relyka:main') return LOOKS.main;
  return LOOKS.info;
}

/** Montants (« 1 440 € », « +1 700 € », « 9,4 mois ») mis en gras dans la phrase. */
const AMOUNT = /([+−-]?\d[\d\s  ]*(?:,\d+)?\s?(?:€|\$|£|CHF|mois))/g;

function Rich({ text, color }: { text: string; color: string }) {
  const parts = text.split(AMOUNT);
  return (
    <GardenText variant="body">
      {parts.map((p, i) => (i % 2 === 1
        ? <GardenText key={i} variant="bodyStrong" color={color}>{p}</GardenText>
        : p))}
    </GardenText>
  );
}

export default function PicoRemark({ message }: { message: RecoMessage }) {
  const look = lookFor(message);
  const [fact, ...tips] = message.text.split('💡').map((s) => s.trim());
  const tip = tips.join(' ').trim();

  return (
    <View style={{ backgroundColor: look.bg, borderRadius: GARDEN_RADII.lg, padding: GARDEN_SPACE.lg, gap: GARDEN_SPACE.md, borderLeftWidth: 5, borderLeftColor: look.fill }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm + 2 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: G.card, alignItems: 'center', justifyContent: 'center' }}>
          <ChoiceIcon name={look.icon} size={18} color={look.fg} />
        </View>
        <GardenText variant="heading" color={look.fg} style={{ flex: 1 }}>{message.label}</GardenText>
      </View>
      {fact ? <Rich text={fact} color={G.ink} /> : null}
      {tip ? (
        <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: GARDEN_RADII.md, padding: GARDEN_SPACE.md }}>
          <Ionicons name="bulb" size={18} color={look.fill} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}><Rich text={tip} color={look.fg} /></View>
        </View>
      ) : null}
    </View>
  );
}
