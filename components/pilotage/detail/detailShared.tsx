/**
 * Briques communes aux quatre sous-blocs des modaux de détail du Pilotage.
 *
 * Elles vivaient dans une IIFE au sommet du modal, donc partagées par simple fermeture. En les
 * sortant, chaque sous-bloc reçoit explicitement ce dont il a besoin — c'est ce qui a permis de
 * découper les 675 lignes sans que les sous-blocs se remettent à dépendre les uns des autres.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCY_SYMBOL, convertAmount, type RatesMap } from '../../../lib/finance/currency';
import { iconForTransaction } from '../../../lib/ui/categoryIcons';
import { hoverRow } from '../../../lib/ui/webLayout';
import { semanticText } from '../../../theme/palette';
import type { AppColors } from '../../../theme/palette';
import type { DetailStyles } from './detailStyles';

/** Montant arrondi, en devise de référence. */
export const fmtAmount = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

/** « 12 juin » — date courte d'une ligne de détail. */
export const shortDate = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

/** Libellé d'une ligne : la note saisie, à défaut la catégorie. */
export const rowLabel = (t: any) => t.note || t.category?.name || 'Opération';

/**
 * Une dépense est « récurrente » soit parce qu'elle a été matérialisée depuis un modèle
 * (`materialized_from` — la migration 030 retire alors `is_recurring`), soit parce que c'est le
 * modèle lui-même, encore ancré sur une date passée du mois.
 */
export const isRecurringTx = (t: any) => !!t.materialized_from || (t.is_recurring && t.recurrence_rule);

/**
 * Conversion des montants dans la devise de RÉFÉRENCE, plus l'override mensuel du template.
 *
 * Deux corrections d'affichage y sont enfermées, et elles doivent le rester :
 *  • sans conversion, un virement cross-devises (ex. −999,50 ¥) s'affichait « 1000 € » au lieu de
 *    ≈ 6 € — d'où l'écart entre le modal et le curseur Épargné / Investi / Dépensé ;
 *  • sans l'override mensuel, une occurrence modifiée pour CE mois gardait son ancien montant dans
 *    le modal alors que le curseur et la liste des transactions montraient déjà le bon.
 */
export function makeAmountResolvers(accounts: any[], refCode: string, rates: RatesMap, pilotageData: any) {
  const curByAcc: Record<string, string> = {};
  accounts.forEach((a) => { curByAcc[a.id] = a.currency; });
  const toRefAmt = (amt: number, accountId: string) =>
    convertAmount(amt, curByAcc[accountId] || refCode, refCode, rates) ?? amt;
  const ovrMap: Record<string, number> = (pilotageData as any).monthOverrides ?? {};
  const toRef = (t: any) => toRefAmt(ovrMap[t.id] != null ? ovrMap[t.id] : Math.abs(Number(t.amount)), t.account_id);
  return { toRefAmt, toRef };
}

interface TxListProps {
  list: any[];
  color: string;
  empty: string;
  /** Ligne « grisée » = occurrence à venir (non encore échue) → non comptée dans le total. */
  dim?: (t: any) => boolean;
  /**
   * Montant à AFFICHER quand ce n'est pas celui de la ligne. Cas réel : une récurrente
   * hebdomadaire dont il reste 2 occurrences sur 4 — le modèle porte le montant d'UNE occurrence,
   * alors que le total « À venir » compte les deux. Sans ce crochet, la somme des lignes ne tombait
   * pas sur le total affiché juste au-dessus.
   */
  amountOf?: (t: any) => number;
  /** Lignes tapables → feuille de détail de l'opération. Faux sur les listes de simple lecture. */
  tappable: boolean;
  onPressTx: (t: any) => void;
  toRef: (t: any) => number;
  colors: AppColors;
  styles: DetailStyles;
}

/** Liste d'opérations d'un modal de détail — le motif de ligne commun aux quatre sous-blocs. */
export function TxList({
  list, color, empty, dim, amountOf, tappable, onPressTx, toRef, colors, styles,
}: TxListProps) {
  if (list.length === 0) return <Text style={styles.detailEmpty}>{empty}</Text>;
  return (
    <>
      {list.map((t, i) => {
        // Remboursement = montant positif (argent qui revient) → vert avec « + ».
        const amt = Number(t.amount);
        const isRefund = amt > 0;
        const dimmed = dim ? dim(t) : false;
        const valColor = dimmed ? colors.textSecondary : (isRefund ? semanticText(colors.green, colors) : color);
        return (
          <TouchableOpacity
            key={t.id ?? i}
            style={[styles.detailRow, dimmed && { opacity: 0.5 }]}
            activeOpacity={tappable ? 0.7 : 1}
            disabled={!tappable}
            onPress={() => onPressTx(t)}
          >
            <Ionicons
              name={iconForTransaction(t) as any}
              size={16}
              color={isRefund && !dimmed ? semanticText(colors.green, colors) : colors.textSecondary}
              style={{ marginRight: 10 }}
            />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailRowLabel} numberOfLines={1}>{rowLabel(t)}</Text>
                {/* Date de la transaction (au lieu de la périodicité). */}
                <Text style={styles.detailRowSub}>{shortDate(t._monthDate ?? t.date)}{dimmed ? ' · à venir' : ''}</Text>
              </View>
              {/* #2 — opération d'un compte partagé : mini-bulle indiquant le % d'impact appliqué. */}
              {t._impact_pct != null && t._impact_pct < 100 && (
                <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.blue + '1A', borderWidth: 1, borderColor: colors.blue + '44' }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: colors.blue }}>{t._impact_pct}%</Text>
                </View>
              )}
            </View>
            <Text style={[styles.detailRowValue, { color: valColor }]}>
              {(isRefund ? '+' : '') + fmtAmount(amountOf ? amountOf(t) : toRef(t))}
            </Text>
          </TouchableOpacity>
        );
      })}
    </>
  );
}

interface DonutLegendProps {
  groups: Array<{ key: string; total: number; icon: string; color: string }>;
  activeKey: string | null;
  onToggle: (key: string) => void;
  styles: DetailStyles;
  colors: AppColors;
}

/** Légende cliquable du camembert : une pastille par catégorie parente, avec son total. */
export function DonutLegend({ groups, activeKey, onToggle, styles, colors }: DonutLegendProps) {
  /* `delayPressIn` diffère la prise du doigt : un glissement démarré sur les pastilles part
     directement au ScrollView, un vrai appui reste normal (le délai est sous le seuil de
     perception). Sans ça, on ressent un scroll « qui galère » quand le geste démarre ici. */
  const scrollFriendlyPress = { delayPressIn: 120 } as const;
  return (
    <View style={styles.pieLegend}>
      {groups.map((g) => {
        const active = activeKey === g.key;
        return (
          <TouchableOpacity
            key={g.key}
            style={[styles.pieLegendItem, active && { borderColor: g.color, backgroundColor: g.color + '1A' }]}
            onPress={() => onToggle(g.key)}
            activeOpacity={0.7}
            {...hoverRow}
            {...scrollFriendlyPress}
          >
            <View style={[styles.pieDot, { backgroundColor: g.color }]} />
            <Ionicons name={g.icon as any} size={13} color={colors.textSecondary} />
            <Text style={styles.pieLegendText} numberOfLines={1}>{g.key}</Text>
            <Text style={[styles.pieLegendVal, { color: g.color }]}>{fmtAmount(g.total)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * Regroupe des opérations par catégorie PARENTE et leur affecte une couleur de palette.
 * Le tri décroissant fixe l'ordre des segments — donc aussi celui des couleurs.
 */
export function groupByParent(
  list: any[],
  parentOf: (t: any) => string,
  amountOf: (t: any) => number,
  iconOf: (t: any) => string,
  palette: string[],
): Array<{ key: string; total: number; icon: string; color: string }> {
  const groups: Record<string, { key: string; total: number; icon: string; color: string }> = {};
  for (const t of list) {
    const key = parentOf(t);
    (groups[key] ??= { key, total: 0, icon: iconOf(t), color: '' });
    groups[key].total += amountOf(t);
  }
  const arr = Object.values(groups).sort((a, b) => b.total - a.total);
  arr.forEach((g, i) => { g.color = palette[i % palette.length]; });
  return arr;
}
