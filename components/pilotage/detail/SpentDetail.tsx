/**
 * « Dépensé ce mois » — camembert des catégories, filtres transverses, liste des opérations.
 *
 * ⚠️ LES FILTRES SONT LOCAUX À CE SOUS-BLOC. Ils vivaient en état de l'écran (`spentFilter`,
 * `spentRecurOnly`, `spentUpcomingOnly`), ce qui obligeait à les passer en props et faisait
 * re-rendre tout le Pilotage à chaque clic sur une pastille. Ils n'intéressent personne d'autre :
 * ils descendent donc avec la vue qu'ils pilotent.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CategoryDonut from '../../charts/CategoryDonut';
import { iconForCategory } from '../../../lib/ui/categoryIcons';
import { hoverRow } from '../../../lib/ui/webLayout';
import { semanticText, type AppColors } from '../../../theme/palette';
import type { DetailStyles } from './detailStyles';
import { TxList, DonutLegend, groupByParent, fmtAmount, isRecurringTx } from './detailShared';

const scrollFriendlyPress = { delayPressIn: 120 } as const;

interface Props {
  spent: any[];
  /** Récurrentes du mois pas encore prélevées (montant restant + liste) — cf. computeRecurUpcoming. */
  recurUpcoming: { amount: number; count: number; list: any[] };
  /** Nom de la catégorie PARENTE, par nom de sous-catégorie en minuscules. */
  catParentName: Record<string, string>;
  toRef: (t: any) => number;
  toRefAmt: (amt: number, accountId: string) => number;
  onPressTx: (t: any) => void;
  isDesktop: boolean;
  colors: AppColors;
  styles: DetailStyles;
}

export default function SpentDetail({
  spent, recurUpcoming, catParentName, toRef, toRefAmt, onPressTx, isDesktop, colors, styles,
}: Props) {
  const [spentFilter, setSpentFilter] = useState<string | null>(null);
  const [spentRecurOnly, setSpentRecurOnly] = useState(false);
  const [spentUpcomingOnly, setSpentUpcomingOnly] = useState(false);

  // Répartition par CATÉGORIE PARENTE (camembert cliquable → filtre la liste, §N2)
  const parentOf = (t: any) => {
    const sub = t.category?.name || 'Autre';
    return catParentName[String(sub).toLowerCase()] || sub;
  };
  // Filtre « Récurrentes » : combiné au filtre par catégorie, il répond à la question
  // « qu'est-ce que je paie tous les mois, là-dedans ? ».
  const recurSpent = spent.filter(isRecurringTx);
  /* Filtre « À venir » : les occurrences récurrentes du mois PAS ENCORE prélevées. Elles ne sont
     évidemment pas « dépensées » — elles ne comptent donc dans aucun total, et s'affichent grisées,
     exactement comme dans le modal des récurrentes. Mais c'est ici qu'on se pose la question
     « et qu'est-ce qui va encore tomber ? ». */
  const upcomingList = recurUpcoming.list;
  const viewingUpcoming = spentUpcomingOnly && upcomingList.length > 0;

  /* ⚠️ Le graphique se calcule sur la liste FILTRÉE, pas sur toutes les dépenses. Seul le montant
     au centre suivait les filtres : l'anneau et sa légende restaient ceux du mois entier, si bien
     qu'en cochant « Récurrentes » on lisait un total récurrent posé sur une répartition qui ne
     l'était pas. */
  const chartSource = viewingUpcoming ? upcomingList
    : spentRecurOnly ? recurSpent
    : spent;

  const palette = [colors.danger, colors.orange, colors.violet, colors.blue, colors.green, colors.teal, colors.yellow, colors.emerald, colors.checking];
  const arr = groupByParent(chartSource, parentOf, toRef, (t) => iconForCategory(t.category), palette);
  const byKey: Record<string, { key: string; total: number }> = {};
  arr.forEach((g) => { byKey[g.key] = g; });
  const totalSpent = arr.reduce((s, g) => s + g.total, 0);

  /* Catégorie choisie AVANT de cocher « Récurrentes » : elle peut ne plus exister dans la nouvelle
     répartition (rien de récurrent dans cette catégorie). On l'ignore alors, au lieu d'afficher une
     liste vide et un total à 0. */
  const effectiveFilter = spentFilter && byKey[spentFilter] ? spentFilter : null;
  const filtered = effectiveFilter
    ? chartSource.filter((t) => parentOf(t) === effectiveFilter)
    : chartSource;
  // Centre de l'anneau : ce que la liste affichée représente réellement.
  const centerVal = effectiveFilter ? (byKey[effectiveFilter]?.total ?? 0) : totalSpent;
  // Totaux des PASTILLES : ce qu'elles sélectionneraient, donc calculés hors filtre.
  const recurSpentTotal = recurSpent.reduce((s, t) => s + toRef(t), 0);
  const upcomingTotal = recurUpcoming.amount;

  /* Il y avait ici un second onglet « Budget ». Il faisait DOUBLON avec l'onglet Budget de la barre
     principale, qui montre les mêmes chiffres en mieux (périodes, année, historique, édition). Deux
     endroits pour la même information, c'est deux endroits à tenir d'accord — et un utilisateur qui
     ne sait plus lequel fait foi. */
  return (
    <>
      {arr.length > 0 && (
        <>
          <View style={isDesktop ? styles.chartBlockDesktop : undefined}>
            <View style={{ alignItems: 'center', marginBottom: isDesktop ? 0 : 10 }}>
              <CategoryDonut
                segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                size={isDesktop ? 184 : 150}
                strokeWidth={isDesktop ? 24 : 20}
                activeKey={effectiveFilter}
                centerLabel={fmtAmount(centerVal)}
                centerSub={viewingUpcoming ? 'à venir' : spentRecurOnly ? 'récurrent' : undefined}
                centerColor={colors.text}
                centerSubColor={colors.textSecondary}
              />
            </View>
            <View style={isDesktop ? styles.chartLegendDesktop : undefined}>
              <DonutLegend
                groups={arr}
                activeKey={effectiveFilter}
                onToggle={(key) => {
                  setSpentUpcomingOnly(false);
                  setSpentFilter(effectiveFilter === key ? null : key);
                }}
                styles={styles}
                colors={colors}
              />
              {/* Filtres TRANSVERSES, sur leur propre ligne : ce ne sont pas des parts du
                  camembert, ils traversent toutes les catégories. */}
              {(recurSpent.length > 0 || upcomingList.length > 0) && (
                <View style={styles.filterBar}>
                  <Text style={styles.filterBarLabel}>Filtres</Text>
                  {recurSpent.length > 0 && (
                    <TouchableOpacity
                      style={[styles.filterChip, spentRecurOnly && { borderColor: colors.orange, backgroundColor: colors.orange + '1A' }]}
                      onPress={() => { setSpentUpcomingOnly(false); setSpentRecurOnly((v) => !v); }}
                      activeOpacity={0.7}
                      {...hoverRow}
                      {...scrollFriendlyPress}
                    >
                      <Ionicons name="repeat" size={13} color={colors.orange} />
                      <Text style={styles.filterChipText} numberOfLines={1}>Récurrentes</Text>
                      <Text style={[styles.filterChipVal, { color: semanticText(colors.orange, colors) }]}>{fmtAmount(recurSpentTotal)}</Text>
                    </TouchableOpacity>
                  )}
                  {upcomingList.length > 0 && (
                    <TouchableOpacity
                      style={[styles.filterChip, viewingUpcoming && { borderColor: colors.textSecondary, backgroundColor: colors.textSecondary + '1A' }]}
                      onPress={() => { setSpentRecurOnly(false); setSpentFilter(null); setSpentUpcomingOnly((v) => !v); }}
                      activeOpacity={0.7}
                      {...hoverRow}
                      {...scrollFriendlyPress}
                    >
                      <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.filterChipText} numberOfLines={1}>À venir</Text>
                      <Text style={[styles.filterChipVal, { color: colors.textSecondary }]}>{fmtAmount(upcomingTotal)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </View>
          <View style={styles.suiviDivider} />
        </>
      )}
      {viewingUpcoming
        ? (
          <TxList
            list={filtered}
            color={colors.textSecondary}
            empty="Aucune récurrente à venir ce mois."
            dim={() => true}
            // Montant RESTANT du mois (`_left`, posé par computeRecurUpcoming) → Σ lignes = total du filtre.
            amountOf={(t: any) => toRefAmt(t._left ?? 0, t.account_id)}
            tappable
            onPressTx={onPressTx}
            toRef={toRef}
            colors={colors}
            styles={styles}
          />
        )
        : (
          <TxList
            list={filtered}
            color={semanticText(colors.danger, colors)}
            empty="Aucune dépense passée ce mois."
            tappable
            onPressTx={onPressTx}
            toRef={toRef}
            colors={colors}
            styles={styles}
          />
        )}
    </>
  );
}
