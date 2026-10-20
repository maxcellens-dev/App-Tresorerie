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
import GardenText from './GardenText';
import GardenIcon from './GardenIcon';
import ChoiceIcon from './ChoiceIcon';
import { GARDEN_ICONS, RECO_ICON, type GardenIconKey } from '../../lib/garden/icons';
import type { RecoMessage } from '../../lib/finance/recoMessages';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';

interface Look { bg: string; fg: string; fill: string; icon: string }

/* Icône et couleurs : lib/garden/icons (UNE par sens, la même que sur les gestes et les comptes). */
const LOOKS: Record<string, Look> = live(() => {
  const L = (k: GardenIconKey): Look => { const i = GARDEN_ICONS[k]; return { bg: i.bg, fg: i.fg, fill: i.fill, icon: i.icon }; };
  return {
    save: L(RECO_ICON.save), invest: L(RECO_ICON.invest), enjoy: L(RECO_ICON.enjoy), keep: L(RECO_ICON.keep),
    trough: L('trough'), budget: L('budget'), warn: L('warn'), main: L('main'), info: L('info'),
  };
});

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
        <GardenIcon icon={look.icon} fg={look.fg} bg={G.card} />
        <GardenText variant="heading" color={look.fg} style={{ flex: 1 }}>{message.label}</GardenText>
      </View>
      {fact ? <Rich text={fact} color={G.ink} /> : null}
      {tip ? (
        <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: GARDEN_RADII.md, padding: GARDEN_SPACE.md }}>
          <View style={{ marginTop: 1 }}><ChoiceIcon name={GARDEN_ICONS.tip.icon} size={18} color={look.fg} /></View>
          <View style={{ flex: 1 }}><Rich text={tip} color={look.fg} /></View>
        </View>
      ) : null}
    </View>
  );
}
