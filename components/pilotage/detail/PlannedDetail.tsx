/**
 * « Dépenses prévues restantes » (vue détaillée) — deux onglets :
 *  • `recurrentes` : camembert des récurrentes du mois, filtre par catégorie ou « À venir » ;
 *  • `variables`   : d'où sort l'enveloppe variable, et comment la corriger.
 *
 * ⚠️ Le camembert des récurrentes n'avait pour seule entrée qu'un bouton de pied de
 * `PlannedSimpleDetail`, retiré depuis : cette branche n'est donc plus atteinte par ce chemin-là.
 * Conservée telle quelle — la retirer serait une décision produit, pas un déplacement de code.
 *
 * Le filtre par catégorie est LOCAL : il ne pilote que cette vue.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CategoryDonut from '../../charts/CategoryDonut';
import { iconForCategory } from '../../../lib/ui/categoryIcons';
import { hoverRow } from '../../../lib/ui/webLayout';
import { semanticText, type AppColors } from '../../../theme/palette';
import type { DetailStyles } from './detailStyles';
import { TxList, DonutLegend, groupByParent, fmtAmount } from './detailShared';

const scrollFriendlyPress = { delayPressIn: 120 } as const;
/** Clé du filtre transverse « À venir » — ce n'est pas une catégorie, d'où une clé réservée. */
const UPCOMING_KEY = '__upcoming__';

interface Props {
  tab: 'recurrentes' | 'variables';
  recurrentes: any[];
  pilotageData: any;
  profile: any;
  varSpentMonth: number;
  catParentName: Record<string, string>;
  toRef: (t: any) => number;
  toRefAmt: (amt: number, accountId: string) => number;
  onPressTx: (t: any) => void;
  /** Ferme le modal puis ouvre le profil financier. */
  onOpenProfile: () => void;
  /** Ferme le modal puis ouvre la saisie de l'estimation. */
  onEditEstimate: () => void;
  isDesktop: boolean;
  colors: AppColors;
  styles: DetailStyles;
}

export default function PlannedDetail({
  tab, recurrentes, pilotageData, profile, varSpentMonth, catParentName, toRef, toRefAmt,
  onPressTx, onOpenProfile, onEditEstimate, isDesktop, colors, styles,
}: Props) {
  const [recurFilter, setRecurFilter] = useState<string | null>(null);

  if (tab !== 'recurrentes') {
    return (
      <View style={{ gap: 6, paddingTop: 4 }}>
        <Text style={styles.detailNote}>
          {pilotageData.variable_envelope_source === 'history'
            ? `Estimation basée sur la moyenne de tes ${pilotageData.variable_envelope_months_used} derniers mois.`
            : pilotageData.variable_envelope_source === 'onboarding'
            ? 'Estimation basée sur le budget variable indiqué à l\'inscription.'
            : 'Pas encore assez d\'historique pour estimer tes dépenses variables.'}
        </Text>
        {/* Info non renseignée (ex. questionnaire passé) → estimation à 0 €. On renvoie vers
            « Mon profil financier » pour la compléter (profil fiable). */}
        {pilotageData.variable_envelope_source !== 'history' && !profile?.weekly_variable_budget && (
          <TouchableOpacity style={styles.varProfileBanner} activeOpacity={0.8} onPress={onOpenProfile}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.orange} />
            <Text style={styles.varProfileBannerText}>
              Tu n'as pas encore indiqué tes dépenses variables — sans elles, l'estimation reste à 0 €. Complète ton profil pour un suivi fiable.
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.orange} />
          </TouchableOpacity>
        )}
        {[
          { l: 'Enveloppe estimée', v: pilotageData.variable_envelope_initial, c: colors.text },
          { l: 'Déjà dépensé ce mois', v: varSpentMonth, c: colors.textSecondary },
          { l: 'Restant estimé', v: Math.max(0, (pilotageData.variable_envelope_initial ?? 0) - varSpentMonth), c: semanticText(colors.orange, colors) },
        ].map((r) => (
          <View key={r.l} style={styles.detailRow}>
            <Text style={[styles.detailRowLabel, { flex: 1 }]}>{r.l}</Text>
            <Text style={[styles.detailRowValue, { color: r.c }]}>{fmtAmount(r.v)}</Text>
          </View>
        ))}
        {pilotageData.variable_envelope_source !== 'history' && (
          <TouchableOpacity style={styles.detailEditBtn} activeOpacity={0.7} onPress={onEditEstimate}>
            <Ionicons name="create-outline" size={15} color={colors.emerald} />
            <Text style={styles.detailEditBtnText}>Modifier l'estimation</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Échue (comptée) vs à venir (non échue ce mois) — `_monthPassed` = part déjà passée.
  const isUpcoming = (t: any) => (t._monthPassed ?? 0) <= 0;
  const parentName = (t: any) => catParentName[String(t.category?.name || 'Autre').toLowerCase()] || (t.category?.name || 'Autre');
  const viewingUpcoming = recurFilter === UPCOMING_KEY;
  // Montant compté (échu) / à venir (non échu) de chaque récurrence, en devise de réf.
  const passedAmt = (t: any) => toRefAmt(t._monthPassed ?? 0, t.account_id);
  const upcomingAmt = (t: any) => toRefAmt(Math.max(0, (t._monthTotal ?? 0) - (t._monthPassed ?? 0)), t.account_id);
  /* Donut = répartition de TOUTES les récurrentes du mois (échues + à venir) → toujours visible dès
     qu'il y a ≥1 récurrente, et filtrable par catégorie même si tout est à venir. */
  const amtOfTotal = (t: any) => passedAmt(t) + upcomingAmt(t);

  const palette = [colors.orange, colors.danger, colors.violet, colors.blue, colors.green, colors.teal, colors.yellow, colors.emerald, colors.checking];
  const arr = groupByParent(recurrentes, parentName, amtOfTotal, (t) => iconForCategory(t.category), palette)
    .filter((g) => g.total > 0);
  // La palette est réaffectée après le filtrage : sinon un groupe à 0 € consommerait une couleur.
  arr.forEach((g, i) => { g.color = palette[i % palette.length]; });
  const byKey: Record<string, { key: string; total: number }> = {};
  arr.forEach((g) => { byKey[g.key] = g; });
  const totalDonut = arr.reduce((s, g) => s + g.total, 0);
  const upcomingTotal = recurrentes.reduce((s, t) => s + upcomingAmt(t), 0);
  // Liste : « À venir » → seulement les non-échues ; catégorie → cette catégorie ; sinon tout.
  const list = viewingUpcoming
    ? recurrentes.filter(isUpcoming)
    : recurFilter
      ? recurrentes.filter((t) => parentName(t) === recurFilter)
      : recurrentes;
  const centerVal = viewingUpcoming ? upcomingTotal : (recurFilter ? (byKey[recurFilter]?.total ?? 0) : totalDonut);

  return (
    <>
      {(arr.length > 0 || upcomingTotal > 0) && (
        <>
          <View style={isDesktop ? styles.chartBlockDesktop : undefined}>
            {arr.length > 0 && (
              <View style={{ alignItems: 'center', marginBottom: isDesktop ? 0 : 10 }}>
                <CategoryDonut
                  segments={arr.map((g) => ({ key: g.key, value: g.total, color: g.color }))}
                  size={isDesktop ? 184 : 150}
                  strokeWidth={isDesktop ? 24 : 20}
                  activeKey={viewingUpcoming ? null : recurFilter}
                  centerLabel={fmtAmount(centerVal)}
                  centerSub={viewingUpcoming ? 'à venir' : undefined}
                  centerColor={colors.text}
                  centerSubColor={colors.textSecondary}
                />
              </View>
            )}
            <View style={isDesktop ? styles.chartLegendDesktop : undefined}>
              <DonutLegend
                groups={arr}
                activeKey={viewingUpcoming ? null : recurFilter}
                onToggle={(key) => setRecurFilter(recurFilter === key ? null : key)}
                styles={styles}
                colors={colors}
              />
              {/* « À venir » n'est pas une catégorie : c'est un filtre qui traverse tout le
                  camembert. Il sort donc de la légende, sur sa propre ligne. */}
              {upcomingTotal > 0 && (
                <View style={styles.filterBar}>
                  <Text style={styles.filterBarLabel}>Filtres</Text>
                  <TouchableOpacity
                    style={[styles.filterChip, viewingUpcoming && { borderColor: colors.textSecondary, backgroundColor: colors.textSecondary + '1A' }]}
                    onPress={() => setRecurFilter(viewingUpcoming ? null : UPCOMING_KEY)}
                    activeOpacity={0.7}
                    {...hoverRow}
                    {...scrollFriendlyPress}
                  >
                    <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.filterChipText} numberOfLines={1}>À venir</Text>
                    <Text style={[styles.filterChipVal, { color: colors.textSecondary }]}>{fmtAmount(upcomingTotal)}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
          <View style={styles.suiviDivider} />
        </>
      )}
      <TxList
        list={list}
        color={semanticText(colors.orange, colors)}
        empty="Aucune dépense récurrente."
        dim={isUpcoming}
        tappable
        onPressTx={onPressTx}
        toRef={toRef}
        colors={colors}
        styles={styles}
      />
    </>
  );
}
