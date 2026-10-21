/**
 * « À venir d'ici la fin du mois » — les opérations déjà inscrites qui n'ont pas encore eu lieu
 * (prélèvements et rentrées récurrents, opérations saisies pour plus tard). Cf. lib/finance/monthUpcoming.
 *
 * `UpcomingRows` : les lignes datées, dans une carte. `UpcomingPanel` : la liste complète, avec les
 * totaux et un filtre Tout / Sorties / Rentrées.
 */
import { useState } from 'react';
import { View } from 'react-native';
import GardenText from './GardenText';
import GardenSegmented from './GardenSegmented';
import MonthTxRow, { MonthTxCard } from './MonthTxRow';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { MonthUpcoming, UpcomingItem } from '../../lib/finance/monthUpcoming';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

function subOf(it: UpcomingItem): string {
  const parts: string[] = [];
  const t = it.tx;
  if (t?.category?.name && t?.note) parts.push(t.category.name);
  if (it.source === 'recurring') parts.push(it.occurrences > 1 ? `${it.occurrences} fois d'ici la fin du mois` : 'opération récurrente');
  else parts.push('déjà saisie');
  return parts.join(' · ');
}

export function UpcomingRows({ items, onOpen }: { items: UpcomingItem[]; onOpen: (it: UpcomingItem) => void }) {
  return (
    <MonthTxCard>
      {items.map((it, i) => (
        <MonthTxRow key={it.key} t={it.tx} first={i === 0} amount={it.amount} positive={it.kind === 'income'}
          dateBadge={it.date} sub={subOf(it)} onPress={() => onOpen(it)} />
      ))}
    </MonthTxCard>
  );
}

type Filter = 'all' | 'expense' | 'income';

/**
 * Le contenu complet de « À venir » : sorties et rentrées prévues, filtre Tout / Sorties / Rentrées,
 * les lignes datées. Affiché tel quel dans le mois de l'arrosoir (MonthPanel, « D'ici la fin du mois ») —
 * c'était le contenu d'une fenêtre, en double avec cette section.
 */
/** `totals` : les deux tuiles Sorties / Rentrées. Le mois de l'arrosoir les remplace par une ligne dans
 *  le titre (UpcomingTotals) : deux tuiles de plus, sous « Dépensé / Encore prévu », faisaient doublon. */
export function UpcomingPanel({ upcoming, onOpen, totals = true }: { upcoming: MonthUpcoming; onOpen: (it: UpcomingItem) => void; totals?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const items = filter === 'all' ? upcoming.items : upcoming.items.filter((i) => i.kind === filter);
  const hasIncome = upcoming.incomeTotal > 0;
  return (
    <View style={{ gap: GARDEN_SPACE.md }}>
      {totals ? <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.md }}>
        <View style={{ flex: 1, gap: 2, padding: GARDEN_SPACE.md, borderRadius: 18, backgroundColor: G.fruitsBg }}>
          <GardenText variant="small" color={G.fruitsText}>Sorties prévues</GardenText>
          <GardenText variant="heading" tabular color={G.fruitsText}>− {eur(upcoming.expenseTotal)}</GardenText>
        </View>
        <View style={{ flex: 1, gap: 2, padding: GARDEN_SPACE.md, borderRadius: 18, backgroundColor: G.branchesBg }}>
          <GardenText variant="small" color={G.branchesText}>Rentrées prévues</GardenText>
          <GardenText variant="heading" tabular color={G.branchesText}>+ {eur(upcoming.incomeTotal)}</GardenText>
        </View>
      </View> : null}
      {hasIncome && upcoming.expenseTotal > 0 ? (
        <GardenSegmented<Filter> accessibilityLabel="Filtrer les opérations à venir" value={filter} onChange={setFilter}
          items={[{ key: 'all', label: 'Tout' }, { key: 'expense', label: 'Sorties' }, { key: 'income', label: 'Rentrées' }]} />
      ) : null}
      {items.length === 0
        ? <GardenText variant="body" color={G.inkSoft} center style={{ paddingVertical: GARDEN_SPACE.xl }}>Plus rien d'inscrit d'ici la fin du mois.</GardenText>
        : <UpcomingRows items={items} onOpen={onOpen} />}
      <GardenText variant="small" color={G.muted} center>
        Tes dépenses du quotidien (courses, sorties…) ne sont pas listées ici : elles sont estimées dans « Encore prévu ».
      </GardenText>
    </View>
  );
}

/** Les totaux à venir en une ligne discrète (titre de section) : sorties en rouge, rentrées en vert ;
 *  un total nul n'est pas affiché. */
export function UpcomingTotals({ upcoming }: { upcoming: MonthUpcoming }) {
  const parts: { text: string; color: string; label: string }[] = [];
  if (upcoming.expenseTotal > 0) parts.push({ text: `− ${eur(upcoming.expenseTotal)}`, color: G.fruitsText, label: `${eur(upcoming.expenseTotal)} de sorties prévues` });
  if (upcoming.incomeTotal > 0) parts.push({ text: `+ ${eur(upcoming.incomeTotal)}`, color: G.branchesText, label: `${eur(upcoming.incomeTotal)} de rentrées prévues` });
  if (!parts.length) return null;
  return (
    <GardenText variant="smallStrong" tabular accessibilityLabel={parts.map((p) => p.label).join(', ')}>
      {parts.map((p, i) => <GardenText key={p.text} variant="smallStrong" tabular color={p.color}>{i ? '  ·  ' : ''}{p.text}</GardenText>)}
    </GardenText>
  );
}
