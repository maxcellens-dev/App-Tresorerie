/**
 * Feuille de détail d'une partie de l'arbre touchée sur l'accueil du Jardin.
 *
 * Chaque feuille montre les VRAIS chiffres de la partie (les mêmes que le Pilotage et que Mon argent)
 * et propose au plus une action, vers un écran qui existe déjà.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { menuHref } from './GardenTabBar';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenCard from './GardenCard';
import GardenButton from './GardenButton';
import GardenBar from './GardenBar';
import type { HotspotPart } from '../../lib/garden/sceneTypes';
import type { TreeState } from '../../lib/garden/treeState';
import { creditKind } from '../../lib/garden/gardenInputs';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../lib/finance/currency';
import { GardenRowGroup } from './GardenList';
import { useMonthPanel } from './MonthPanel';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../lib/garden/theme';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { TREE_PARTS, WORDS, rootsGoal } from '../../lib/garden/lexicon';

export interface CanFigures {
  checking: number; spent: number; leftToSpend: number; variableSource?: string | null;
  minimum: number; lowest: number; lowestDate: string | null;
}

interface Props {
  part: HotspotPart | null;
  onClose: () => void;
  tree: TreeState;
  can: CanFigures | null;
  credits: { id: string; label: string; rateAnnual: number; principal: number; remaining: number }[];
  savingsTotal: number;
  investedTotal: number;
  /** Montant « pour te faire plaisir » du mois (recommandation Confort). */
  enjoyAmount?: number;
  /** Placements (comptes d'investissement) : un fruit chacun. */
  investments?: { id: string; name: string; balance: number; currency?: string }[];
  /** Données du Pilotage : la fiche de l'arrosoir y lit le mois (useMonthPanel). */
  core?: PilotageCore;
}

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <GardenCard style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
      <View style={{ flex: 1 }}>
        <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>{label}</GardenText>
        {hint ? <GardenText variant="small" color={GARDEN_COLORS.muted}>{hint}</GardenText> : null}
      </View>
      <GardenText variant="bodyStrong" tabular>{value}</GardenText>
    </GardenCard>
  );
}

export default function TreePartSheet({ part, onClose, tree, can, credits, savingsTotal, investedTotal, enjoyAmount = 0, investments = [], core }: Props) {
  const router = useRouter();
  const go = (route: string) => { onClose(); setTimeout(() => router.push(route as any), 60); };
  if (!part || part === 'pico') return null;

  if (part === 'can') return core ? <ArrosoirSheet core={core} can={can} onClose={onClose} onTour={() => go('/(tabs)/comptes/solde')} /> : null;

  if (part === 'roots') {
    const m = tree.roots.months;
    const [k1, k2, k3, k4] = tree.roots.markMonths;
    const next = m < k1 ? k1 : m < k2 ? k2 : m < k3 ? k3 : m < k4 ? k4 : null;
    return (
      <GardenSheet visible onClose={onClose} title={TREE_PARTS.roots.name} subtitle={TREE_PARTS.roots.meaning}
        footer={<GardenButton label="Voir mon épargne" variant="secondary" onPress={() => go(menuHref('argent'))} />}>
        <Row label="Épargne disponible" value={eur(savingsTotal)} />
        <Row label="Ça couvre" value={`${months(m)} mois`} hint="de tes dépenses essentielles" />
        {next ? (
          <GardenCard tint={GARDEN_COLORS.rootsBg}>
            <GardenText variant="heading">{next === k4 ? `Couche dorée : atteins ${months(k4)} mois d'épargne` : rootsGoal(next)}</GardenText>
            {next === k4 ? <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>Tes {months(k3)} mois sont là, c'est solide. À {months(k4)} mois, une couche dorée apparaît sous tes racines.</GardenText> : null}
            <GardenBar value={m / next} fill={GARDEN_COLORS.roots} track="#F6E9CC" accessibilityLabel={`${months(m)} mois sur ${next}`} />
          </GardenCard>
        ) : (
          <GardenCard tint={GARDEN_COLORS.rootsBg}>
            <GardenText variant="body">La couche dorée est là : tes racines dépassent les {months(k4)} mois{tree.roots.beyondLast ? ` de ${months(tree.roots.extraMonths)} mois` : ''}. Ce qui dépasse pourrait être placé : ce sont les graines qui dorment sous ton arbre.</GardenText>
          </GardenCard>
        )}
      </GardenSheet>
    );
  }

  if (part === 'flowers') {
    return (
      <GardenSheet visible onClose={onClose} title={TREE_PARTS.flowers.name} subtitle={TREE_PARTS.flowers.meaning}>
        <Row label="Pour toi ce mois-ci" value={eur(enjoyAmount)} hint="la part de ton Relyka pour te faire plaisir" />
        <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>Ces fleurs, c'est l'argent que Pépin te propose de dépenser pour toi, sans culpabiliser : un resto, une sortie, un petit plaisir. Plus cette part est grande, plus ton jardin fleurit.</GardenText>
      </GardenSheet>
    );
  }

  if (part === 'tree') {
    return (
      <GardenSheet visible onClose={onClose} title={TREE_PARTS.branches.name} subtitle={TREE_PARTS.branches.meaning}
        footer={<GardenButton label="Voir ce qu'ils peuvent devenir" variant="secondary" onPress={() => go('/(tabs)/(secondary)/placements')} />}>
        <Row label="Valeur de tes placements" value={eur(investedTotal)} hint={tree.investments ? (tree.maturity === 'golden' ? 'Belle plus-value : tes fruits sont dorés' : tree.ripe ? 'En gain : tes fruits sont mûrs' : 'Pas encore de gain : tes fruits mûrissent') : undefined} />
        {/* Tous les placements, un par fruit : chacun ouvre sa fiche. */}
        {investments.length ? (
          <GardenRowGroup rows={investments.map((a) => ({
            key: a.id, label: a.name, sub: 'Investissement',
            value: `${Math.round(a.balance).toLocaleString('fr-FR')} ${currencySymbolFor(a.currency)}`,
            icon: GARDEN_ICONS.fruits.icon, iconColor: GARDEN_ICONS.fruits.fg, iconBg: GARDEN_ICONS.fruits.bg,
            onPress: () => go(`/(tabs)/comptes/${a.id}`),
          }))} />
        ) : (
          <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>Pas encore de placements : ton premier fruit apparaîtra dans l'arbre dès que tu en ajouteras un.</GardenText>
        )}
        {investments.length === 0 ? <GardenButton label="Ajouter un placement" onPress={() => go('/(tabs)/comptes/add')} /> : null}
      </GardenSheet>
    );
  }

  const wanted = part === 'cabin' ? 'healthy' : 'expensive';
  const list = credits.filter((c) => c.remaining > 0 && creditKind(c.rateAnnual) === wanted);
  return (
    <GardenSheet visible onClose={onClose} title={part === 'cabin' ? TREE_PARTS.cabin.name : TREE_PARTS.brambles.name} subtitle={part === 'cabin' ? TREE_PARTS.cabin.meaning : TREE_PARTS.brambles.meaning}>
      <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>
        {part === 'cabin'
          ? "Un crédit finance quelque chose. Chaque mensualité ajoute une planche à la cabane, jusqu'à ce qu'elle soit vraiment à toi."
          : 'Un crédit qui coûte cher. Le rembourser plus vite fait reculer les ronces.'}
      </GardenText>
      {/* Une seule cabane pour tous les crédits : son avancement global, puis chaque crédit. */}
      {/* Tout est remboursé : la cabane est à toi (fanion sur le toit). */}
      {part === 'cabin' && tree.cabin?.owned ? (
        <GardenCard tint={GARDEN_COLORS.pico}>
          <GardenText variant="label" color={GARDEN_COLORS.picoText}>Ta cabane est à toi</GardenText>
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{tree.cabin.count > 1 ? 'Tes crédits sont' : 'Ton crédit est'} entièrement remboursé{tree.cabin.count > 1 ? 's' : ''} : le fanion flotte sur le toit, et la cabane reste dans ton jardin.</GardenText>
        </GardenCard>
      ) : null}
      {part === 'cabin' && tree.cabin && !tree.cabin.owned && tree.cabin.count > 1 ? (
        <GardenCard tint={GARDEN_COLORS.pico}>
          <GardenText variant="label" color={GARDEN_COLORS.picoText}>Ta cabane · {tree.cabin.count} crédits</GardenText>
          <GardenBar value={tree.cabin.progress} fill="#C9A57E" track="#F3E2C8" accessibilityLabel={`Construite à ${Math.round(tree.cabin.progress * 100)} %`} />
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>Construite à {Math.round(tree.cabin.progress * 100)} % : tous tes crédits ensemble, le plus gros compte le plus.</GardenText>
        </GardenCard>
      ) : null}
      {list.map((c) => {
        const progress = c.principal > 0 ? Math.max(0, Math.min(1, 1 - c.remaining / c.principal)) : 0;
        return (
          <GardenCard key={c.id} onPress={() => go(`/(tabs)/comptes/credit/${c.id}`)} accessibilityLabel={`${c.label}, reste ${eur(c.remaining)}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: GARDEN_SPACE.sm }}>
              <GardenText variant="bodyStrong" style={{ flex: 1 }}>{c.label}</GardenText>
              <GardenText variant="small" color={GARDEN_COLORS.muted}>{c.rateAnnual.toLocaleString('fr-FR')} %</GardenText>
            </View>
            <GardenBar value={progress} fill={part === 'cabin' ? '#C9A57E' : GARDEN_COLORS.brambles} accessibilityLabel={`Remboursé à ${Math.round(progress * 100)} %`} />
            <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>Reste {eur(c.remaining)} · remboursé à {Math.round(progress * 100)} %</GardenText>
          </GardenCard>
        );
      })}
    </GardenSheet>
  );
}

/**
 * L'ARROSOIR · ce mois : ce qu'il y a sur tes comptes courants, puis tout le mois (ce qui était
 * l'onglet « Ce mois » de Mon argent). Quand un détail s'ouvre (Dépensé, Encore prévu, réserve…),
 * cette feuille s'efface le temps qu'il soit ouvert : une seule fenêtre à la fois (cf. MonthPanel).
 */
function ArrosoirSheet({ core, can, onClose, onTour }: { core: PilotageCore; can: CanFigures | null; onClose: () => void; onTour: () => void }) {
  const month = useMonthPanel(core, onClose);
  return (
    <>
      <GardenSheet visible={!month.subOpen} onClose={onClose} title={`${TREE_PARTS.can.name} · ce mois`} subtitle={TREE_PARTS.can.meaning}
        footer={<GardenButton label={WORDS.gardenTour} onPress={onTour} />}>
        {can ? (
          <GardenCard tint={GARDEN_ICONS.water.bg} style={{ gap: 2 }}>
            <GardenText variant="label" color={GARDEN_ICONS.water.fg}>Sur tes comptes courants</GardenText>
            <GardenText variant="amount" tabular>{eur(can.checking)}</GardenText>
          </GardenCard>
        ) : null}
        {month.content}
      </GardenSheet>
      {month.sheets}
    </>
  );
}
