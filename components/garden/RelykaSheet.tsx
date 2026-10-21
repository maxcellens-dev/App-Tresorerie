/**
 * « Ton Relyka » — le détail du CALCUL, ouvert en touchant la carte du Relyka (Jardin). Repris de
 * l'ancien détail du Pilotage (components/pilotage/detail/RelykaDetail, retiré avec la refonte), dans
 * la forme du Jardin :
 *   1. le point de départ : le POINT BAS de trésorerie (le plus bas que tes comptes courants
 *      atteindront d'ici la fin de l'horizon), sa date, et ce qu'il englobe déjà ;
 *   2. ce qu'on en RETIRE : épargne et placements à venir, dépenses du quotidien restantes, argent mis
 *      de côté, réserve minimum ;
 *   3. le résultat, avec l'arrondi de la carte (dizaine inférieure) et, quand la carte annonce une
 *      fourchette, pourquoi.
 * Aucun chiffre n'est recalculé ici : tout vient du même cœur que la carte (usePilotageViewModel).
 */
import { View } from 'react-native';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenCard from './GardenCard';
import { GardenRowGroup } from './GardenList';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, floorToTen } from '../../lib/finance/currency';
import { shortDay } from '../../lib/finance/pilotageView';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function RelykaSheet({ visible, onClose, core }: { visible: boolean; onClose: () => void; core: PilotageCore }) {
  const p: any = core.pilotageData;
  const vm: any = core.vm;
  if (!p) return null;

  /* Déjà compris dans le point bas (il rejoue les opérations jour après jour) : on les montre en
     information, sans les retirer une seconde fois. */
  const recurSpent = n(vm.suiviDetail?.recurringPassed);
  const varSpent = p.variable_envelope_spent ?? Math.max(0, n(p.month_expenses_past) - recurSpent);
  const varPlanned = Math.max(0, n(p.variable_envelope_planned));
  const sFut = n(p.month_savings_future), iFut = n(p.month_invest_future);
  const eiDone = Math.max(0, n(p.month_savings_total) - sFut) + Math.max(0, n(p.month_invest_total) - iFut);
  const included = [
    { l: 'Opérations récurrentes du mois', v: n(vm.suiviDetail?.recurringTotal) },
    { l: 'Dépenses du quotidien déjà faites', v: n(varSpent) },
    ...(varPlanned > 0 ? [{ l: 'Dépenses déjà saisies pour les jours à venir', v: varPlanned }] : []),
    { l: 'Épargne et placements déjà virés', v: eiDone },
  ];

  // le point bas tel que le calcul central l'a retenu (jamais relu dans les données brutes)
  const trough = n(vm.cashflowTrough);
  const margin = n(vm.safetyMarginDisplay ?? p.safety_margin_amount);
  const deductions = [
    { key: 'ei', label: 'Épargne et placements à venir', sub: 'les virements prévus ce mois-ci', v: n(vm.savingsRemaining ?? sFut) + n(vm.investRemaining ?? iFut), look: GARDEN_ICONS.roots },
    { key: 'var', label: WORDS.dailyForecast, sub: 'estimées jusqu’à la fin du mois', v: n(vm.variableEnvelopeRemaining ?? p.variable_envelope_remaining), look: GARDEN_ICONS.budget },
    { key: 'aside', label: WORDS.setAside, sub: 'projets, gardé ce mois-ci, en attente de virement', v: n(vm.conservedTotal) + n(vm.cumulsTotal), look: GARDEN_ICONS.setAside },
    { key: 'min', label: WORDS.minimumToKeep, sub: margin > 0 ? 'ce que tu gardes toujours' : 'aucune réserve choisie', v: margin, look: GARDEN_ICONS.water },
  ];
  const result = Math.max(0, n(vm.resteDisponible));
  const shown = n(vm.relykaAffiche ?? floorToTen(result));
  const range = vm.relConf?.relykaRange;

  return (
    <GardenSheet visible={visible} onClose={onClose} title={WORDS.relyka} subtitle="comment il est calculé">
      <GardenCard tint={G.branchesBg} style={{ gap: 2 }}>
        <GardenText variant="label" color={G.branchesText}>Ce qu'il te reste à utiliser</GardenText>
        <GardenText variant="amount" tabular>{eur(result)}</GardenText>
        {shown !== Math.round(result) ? <GardenText variant="small" color={G.inkSoft}>{`Arrondi à ${eur(shown)} sur la carte (dizaine inférieure).`}</GardenText> : null}
      </GardenCard>

      {/* 1 · Le point de départ */}
      <View style={{ gap: GARDEN_SPACE.sm }}>
        <GardenRowGroup title="Le point de départ" rows={[{
          key: 'trough', label: 'Point bas de ton compte courant', value: eur(trough),
          sub: vm.troughDate ? `le ${shortDay(vm.troughDate)}` : 'd’ici la fin du mois',
          icon: GARDEN_ICONS.trough.icon, iconColor: GARDEN_ICONS.trough.fg, iconBg: GARDEN_ICONS.trough.bg,
        }]} />
        {vm.troughExplain ? <GardenText variant="small" color={G.inkSoft} style={{ paddingHorizontal: 4 }}>{vm.troughExplain}</GardenText> : null}
        <View style={{ gap: 4, paddingHorizontal: 4 }}>
          <GardenText variant="smallStrong" color={G.muted}>Déjà compris dans ce point bas :</GardenText>
          {included.map((r) => (
            <View key={r.l} style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm }}>
              <GardenText variant="small" color={G.muted} style={{ flex: 1 }}>· {r.l}</GardenText>
              <GardenText variant="small" color={G.muted} tabular>{eur(r.v)}</GardenText>
            </View>
          ))}
        </View>
      </View>

      {/* 2 · Ce qu'on en retire */}
      <GardenRowGroup title="Ce qu'on en retire" rows={deductions.map((d) => ({
        key: d.key, label: d.label, sub: d.sub, value: d.v > 0 ? `− ${eur(d.v)}` : eur(0),
        icon: d.look.icon, iconColor: d.look.fg, iconBg: d.look.bg,
      }))} />

      {/* 3 · Le résultat */}
      <GardenCard style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
        <GardenText variant="heading" style={{ flex: 1 }}>= {WORDS.relyka}</GardenText>
        <GardenText variant="heading" tabular color={G.branchesText}>{eur(result)}</GardenText>
      </GardenCard>
      {margin <= 0 ? (
        <GardenText variant="small" color={G.inkSoft}>Tu n'as pas choisi de réserve minimum : ce calcul suppose que tu peux descendre ton compte jusqu'à zéro. Tu peux en choisir une dans Mon argent › Ce mois.</GardenText>
      ) : null}
      {range?.isRange ? (
        <GardenText variant="small" color={G.inkSoft}>
          {`Ce calcul suppose que toutes tes dépenses sont saisies. Tant que ton solde n'est pas vérifié, la carte annonce ${
            floorToTen(range.low) > 0 ? `un minimum sûr de ${eur(floorToTen(range.low))}` : 'ce montant comme un maximum'}.`}
        </GardenText>
      ) : null}
    </GardenSheet>
  );
}
