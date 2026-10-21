/**
 * LE MOIS de l'arrosoir (ce qui était l'onglet « Ce mois » de Mon argent, désormais dans la fiche de
 * l'arrosoir du Jardin) :
 *   - le SUIVI : le jour, « Dépensé » (touché : le détail par catégorie et par jour) et « Encore
 *     prévu » (touché : d'où vient le montant, et ses réglages), la part déjà sortie ;
 *   - D'ICI LA FIN DU MOIS : ce qui est inscrit, sorties ET rentrées, en entier ;
 *   - ce que tu PROTÈGES et ce que tu GÈRES : réserve minimum, jour le plus bas, argent mis de côté,
 *     toutes tes opérations récurrentes.
 *
 * `useMonthPanel` rend deux morceaux : le CONTENU (à poser dans la feuille de l'arrosoir) et les
 * FEUILLES de détail (à poser À CÔTÉ, jamais dedans). Une seule fenêtre est visible à la fois :
 * quand un détail s'ouvre, `subOpen` passe à vrai et la feuille de l'arrosoir s'efface, puis revient
 * à sa fermeture — empiler deux <Modal> est fragile (iOS), le reste de l'app l'évite déjà.
 * Les chiffres sont ceux du Pilotage (même cœur de données), jamais recalculés ici.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import GardenText from './GardenText';
import GardenCard from './GardenCard';
import GardenBar from './GardenBar';
import { GardenRowGroup } from './GardenList';
import RecurringTransactionsModal from '../transaction/RecurringTransactionsModal';
import { MarginSheet, EstimateSheet, LeftToSpendSheet } from './MonthSettingsSheets';
import SpentSheet from './SpentSheet';
import SetAsideSheet from './SetAsideSheet';
import { UpcomingPanel, UpcomingTotals } from './UpcomingList';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { useCategories } from '../../hooks/data/useCategories';
import { useRecurringTransactions } from '../../hooks/data/useRecurringTransactions';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, convertAmount } from '../../lib/finance/currency';
import { computeMonthUpcoming, type UpcomingItem } from '../../lib/finance/monthUpcoming';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE, mixHex } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';
import { pointer, transition } from '../../lib/ui/webLayout';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const dayLabel = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : null);

type Sub = null | 'margin' | 'estimate' | 'left' | 'spent' | 'aside' | 'recurring';

/** Un chiffre du mois qui ouvre son détail : libellé, montant, et l'invitation à toucher. */
function MonthTile({ label, value, color, bg, onPress, accessibilityLabel }: {
  label: string; value: string; color: string; bg: string; onPress: () => void; accessibilityLabel: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed, hovered }: any) => [{ flex: 1, minWidth: 0, gap: 2, padding: GARDEN_SPACE.md, borderRadius: GARDEN_RADII.md, backgroundColor: bg, opacity: pressed ? 0.85 : 1 },
        hovered ? { transform: [{ translateY: -1 }] } : null, pointer, transition]}>
      <GardenText variant="small" color={G.inkSoft} numberOfLines={1}>{label}</GardenText>
      <GardenText variant="title" tabular color={color} numberOfLines={1} adjustsFontSizeToFit>{value}</GardenText>
      <GardenText variant="smallStrong" color={color} numberOfLines={1}>Voir le détail ›</GardenText>
    </Pressable>
  );
}

/**
 * @param onLeave appelé AVANT de quitter la fiche pour une autre page (ouvrir une opération) :
 *   le parent ferme la feuille de l'arrosoir.
 */
export function useMonthPanel(core: PilotageCore, onLeave: () => void): { content: ReactNode; sheets: ReactNode; subOpen: boolean } {
  const router = useRouter();
  const { vm, pilotageData: p } = core;
  const [sub, setSub] = useState<Sub>(null);
  const close = () => setSub(null);
  /** Passer d'un détail à un autre : on ferme, puis on ouvre au tour suivant (jamais deux à la fois). */
  const swap = (next: Sub) => { setSub(null); setTimeout(() => setSub(next), 60); };

  const { data: categoriesList = [] } = useCategories(core.userId);
  const { data: recurringAll } = useRecurringTransactions(core.userId);
  // Nom de (sous-)catégorie → nom de la catégorie PARENTE (répartition de « Dépensé »).
  const catParentName = useMemo(() => {
    const byId: Record<string, any> = {};
    for (const c of categoriesList as any[]) byId[c.id] = c;
    const map: Record<string, string> = {};
    for (const c of categoriesList as any[]) {
      if (c.name) map[String(c.name).toLowerCase()] = c.parent_id && byId[c.parent_id] ? byId[c.parent_id].name : c.name;
    }
    return map;
  }, [categoriesList]);
  const refCode = (core.profile as any)?.currency_code ?? 'EUR';
  const curByAcc = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of core.accounts as any[]) m[a.id] = a.currency;
    return m;
  }, [core.accounts]);
  /** Montant compté comme DÉPENSÉ, en devise de référence (remboursement = négatif). */
  const spentRef = (t: any) => {
    const amt = -Number(t.amount);
    return convertAmount(amt, curByAcc[t.account_id] || t.account?.currency || refCode, refCode, core.rates) ?? amt;
  };
  const upcoming = useMemo(() => computeMonthUpcoming({
    recurringExpenses: vm.recurUpcoming?.list ?? [],
    txForSuivi: core.txForSuivi as any[],
    accountsForSuivi: core.accountsForSuivi as any[],
    refCode,
    rates: core.rates,
  }), [vm.recurUpcoming, core.txForSuivi, core.accountsForSuivi, refCode, core.rates]);
  /** Ouvrir une opération : sa fiche de modification ; une échéance de crédit → la page Crédits. */
  const openTx = (t: any) => {
    setSub(null);
    onLeave();
    const id = String(t?.id ?? '');
    const target = t?.credit_id || t?.is_credit_flow || id.startsWith('credit') ? '/(tabs)/(secondary)/credits' : `/(tabs)/transactions/edit/${id}`;
    setTimeout(() => router.push(target as any), 60);
  };
  const openUpcoming = (it: UpcomingItem) => openTx(it.tx);

  if (!core.ready || !p) return { content: null, sheets: null, subOpen: false };

  const spent = Math.max(0, vm.monthExpensesPast ?? 0);
  const variableLeft = Math.max(0, p.variable_envelope_remaining ?? 0);
  const variablePlanned = Math.max(0, p.variable_envelope_planned ?? 0);
  const recurringLeft = Math.max(0, vm.recurUpcoming.amount);
  const leftToSpend = variableLeft + variablePlanned + recurringLeft;
  const monthTotal = spent + leftToSpend;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const monthName = now.toLocaleDateString('fr-FR', { month: 'long' });
  // Lue sur le profil (mise à jour tout de suite) ; repli sur la donnée du Pilotage.
  const margin = Number((core.profile as any)?.safety_margin_amount ?? p.safety_margin_amount ?? 0);
  // réserves de projets + gardé ce mois-ci + virements mis de côté pour plus tard (cf. SetAsideSheet).
  const setAside = (p.monthly_reserve_planned ?? 0) + (vm.reservationsTotal ?? 0) + (vm.preEpargneTotal ?? 0) + (vm.preInvestTotal ?? 0);
  // Teinte de l'estimation : l'eau, adoucie vers la piste (lisible en clair comme en sombre).
  const forecastColor = mixHex(G.water, G.track, 0.5);
  const recurringCount = recurringAll?.length ?? 0;
  const lowest = Number(vm.cashflowTrough ?? p.current_checking_balance ?? 0);

  const content = (
    <>
      {/* 1 · Où en est le mois : le jour, ce qui est parti, ce qui va encore partir. */}
      <GardenCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <GardenText variant="label">Suivi de {monthName}</GardenText>
          <GardenText variant="smallStrong" color={G.inkSoft}>jour {day} sur {daysInMonth}</GardenText>
        </View>
        <GardenBar value={day / daysInMonth} fill={G.primary} track={G.track} accessibilityLabel={`Jour ${day} sur ${daysInMonth}`} />
        <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm, marginTop: GARDEN_SPACE.xs }}>
          <MonthTile label={WORDS.spent} value={eur(spent)} color={G.fruitsText} bg={G.fruitsBg}
            onPress={() => setSub('spent')} accessibilityLabel={`${WORDS.spent} : ${eur(spent)}. Voir le détail des dépenses`} />
          <MonthTile label={WORDS.leftToSpend} value={eur(leftToSpend)} color={G.waterText} bg={G.waterBg}
            onPress={() => setSub('left')} accessibilityLabel={`${WORDS.leftToSpend} : ${eur(leftToSpend)}. Voir d'où vient ce montant et le régler`} />
        </View>
        {monthTotal > 0 ? (
          <View accessibilityLabel={`${eur(spent)} dépensés, ${eur(leftToSpend)} encore à sortir`}
            style={{ flexDirection: 'row', height: 14, borderRadius: GARDEN_RADII.pill, overflow: 'hidden', backgroundColor: G.track }}>
            <View style={{ flex: spent, backgroundColor: G.fruits }} />
            <View style={{ flex: recurringLeft, backgroundColor: G.water }} />
            <View style={{ flex: variableLeft + variablePlanned, backgroundColor: forecastColor }} />
          </View>
        ) : null}
        <GardenText variant="small" color={G.muted}>Soit environ {eur(monthTotal)} de dépenses sur le mois.</GardenText>
      </GardenCard>

      {/* 2 · Ce qui est DÉJÀ INSCRIT d'ici la fin du mois, jour par jour : sorties ET rentrées. */}
      <View style={{ gap: GARDEN_SPACE.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: GARDEN_SPACE.sm, paddingHorizontal: 4 }}>
          <GardenText variant="label" style={{ flex: 1 }}>D'ici la fin du mois</GardenText>
          <UpcomingTotals upcoming={upcoming} />
        </View>
        <UpcomingPanel upcoming={upcoming} onOpen={openUpcoming} totals={false} />
      </View>

      {/* 3 · Ce que tu protèges, et ce que tu gères (TOUTES les récurrentes : le catalogue à modifier). */}
      <GardenRowGroup title="Ce que tu protèges" rows={[
        { key: 'margin', label: WORDS.minimumToKeep, sub: margin > 0 ? "l'eau que tu gardes dans ton arrosoir" : 'aucune réserve choisie, touche pour en choisir une', value: margin > 0 ? eur(margin) : undefined, icon: GARDEN_ICONS.water.icon, iconColor: GARDEN_ICONS.water.fg, iconBg: GARDEN_ICONS.water.bg, onPress: () => setSub('margin') },
        { key: 'low', label: WORDS.lowestDay, sub: dayLabel(vm.troughDate) ?? 'au fil du mois', value: eur(lowest), icon: GARDEN_ICONS.trough.icon, iconColor: GARDEN_ICONS.trough.fg, iconBg: GARDEN_ICONS.trough.bg },
        { key: 'set', label: WORDS.setAside, sub: 'pour un projet ou plus tard', value: eur(setAside), icon: GARDEN_ICONS.setAside.icon, iconColor: GARDEN_ICONS.setAside.fg, iconBg: GARDEN_ICONS.setAside.bg, onPress: () => setSub('aside') },
      ]} />
      <GardenRowGroup rows={[
        { key: 'recurring', label: WORDS.recurring, sub: recurringCount ? `${recurringCount} opération${recurringCount > 1 ? 's' : ''} récurrente${recurringCount > 1 ? 's' : ''} · modifier ou arrêter` : 'salaire, loyer, abonnements… à ajouter', icon: GARDEN_ICONS.recurring.icon, iconColor: GARDEN_ICONS.recurring.fg, iconBg: GARDEN_ICONS.recurring.bg, onPress: () => setSub('recurring') },
      ]} />
    </>
  );

  const sheets = (
    <>
      <RecurringTransactionsModal visible={sub === 'recurring'} onClose={close} userId={core.userId} />
      <SpentSheet visible={sub === 'spent'} onClose={close} spent={vm.suiviDetail?.spent ?? []} monthName={monthName}
        catParentName={catParentName} spentRef={spentRef} onOpenTx={openTx} />
      <SetAsideSheet visible={sub === 'aside'} onClose={close} core={core} />
      <MarginSheet visible={sub === 'margin'} onClose={close} userId={core.userId} />
      <EstimateSheet visible={sub === 'estimate'} onClose={close} userId={core.userId} />
      <LeftToSpendSheet
        visible={sub === 'left'}
        onClose={close}
        userId={core.userId}
        pilotageData={p}
        pilotageQuery={core.pilotageQuery as any}
        recurringLeft={recurringLeft}
        recurringCount={vm.recurUpcoming.count}
        relykaBefore={vm.relykaAffiche}
        breakdownExtras={{ reservationsTotal: vm.reservationsTotal, preEpargneTotal: vm.preEpargneTotal, preInvestTotal: vm.preInvestTotal }}
        onShowRecurring={() => swap('recurring')}
        onEditEstimate={() => swap('estimate')}
      />
    </>
  );

  return { content, sheets, subOpen: sub !== null };
}
