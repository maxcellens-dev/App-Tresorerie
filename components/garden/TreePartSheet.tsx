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
import type { HotspotPart } from '../../lib/garden/sceneSvg';
import type { TreeState } from '../../lib/garden/treeState';
import { creditKind } from '../../lib/garden/gardenInputs';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../lib/finance/currency';
import { GardenRowGroup } from './GardenList';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../lib/garden/theme';
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
}

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const dayLabel = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : null);

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

export default function TreePartSheet({ part, onClose, tree, can, credits, savingsTotal, investedTotal, enjoyAmount = 0, investments = [] }: Props) {
  const router = useRouter();
  const go = (route: string) => { onClose(); setTimeout(() => router.push(route as any), 60); };
  if (!part || part === 'pico') return null;

  if (part === 'can') {
    return (
      <GardenSheet visible onClose={onClose} title={`${TREE_PARTS.can.name} · ce mois`} subtitle={TREE_PARTS.can.meaning}
        footer={<GardenButton label={WORDS.gardenTour} onPress={() => go('/(tabs)/comptes/solde')} />}>
        {can ? (
          <>
            <Row label="Sur tes comptes courants" value={eur(can.checking)} />
            <Row label={WORDS.spent} value={eur(can.spent)} hint="depuis le début du mois" />
            <Row label={WORDS.leftToSpend} value={eur(can.leftToSpend)} hint={`${WORDS.leftToSpendHint}, ${can.variableSource === 'onboarding' ? "d'après ton estimation" : "d'après tes habitudes"}`} />
            <Row label={WORDS.minimumToKeep} value={eur(can.minimum)} hint="ton compte ne descend pas en dessous" />
            <Row label={WORDS.lowestDay} value={eur(can.lowest)} hint={dayLabel(can.lowestDate) ?? undefined} />
          </>
        ) : null}
      </GardenSheet>
    );
  }

  if (part === 'roots') {
    const m = tree.roots.months;
    const next = m < 1 ? 1 : m < 3 ? 3 : m < 6 ? 6 : null;
    return (
      <GardenSheet visible onClose={onClose} title={TREE_PARTS.roots.name} subtitle={TREE_PARTS.roots.meaning}
        footer={<GardenButton label="Voir mon épargne" variant="secondary" onPress={() => go(menuHref('argent'))} />}>
        <Row label="Épargne disponible" value={eur(savingsTotal)} />
        <Row label="Ça couvre" value={`${months(m)} mois`} hint="de tes dépenses essentielles" />
        {next ? (
          <GardenCard tint={GARDEN_COLORS.rootsBg}>
            <GardenText variant="heading">{rootsGoal(next)}</GardenText>
            <GardenBar value={m / next} fill={GARDEN_COLORS.roots} track="#F6E9CC" accessibilityLabel={`${months(m)} mois sur ${next}`} />
          </GardenCard>
        ) : (
          <GardenCard tint={GARDEN_COLORS.rootsBg}>
            <GardenText variant="body">Tes racines dépassent les 6 mois{tree.roots.beyondSix ? ` de ${months(tree.roots.extraMonths)} mois` : ''}. Ce qui dépasse pourrait être placé : ce sont les graines qui dorment sous ton arbre.</GardenText>
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
        <Row label="Valeur de tes placements" value={eur(investedTotal)} hint={tree.investments ? `${tree.investments} placement${tree.investments > 1 ? 's' : ''}, ${tree.ripe ? 'en gain : tes fruits sont mûrs' : 'tes fruits mûrissent'}` : undefined} />
        {/* Tous les placements, un par fruit : chacun ouvre sa fiche. */}
        {investments.length ? (
          <GardenRowGroup rows={investments.map((a) => ({
            key: a.id, label: a.name, sub: 'Investissement',
            value: `${Math.round(a.balance).toLocaleString('fr-FR')} ${currencySymbolFor(a.currency)}`,
            icon: 'nutrition-outline', iconColor: GARDEN_COLORS.fruitsText, iconBg: GARDEN_COLORS.fruitsBg,
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
      {part === 'cabin' && tree.cabin && tree.cabin.count > 1 ? (
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
