/**
 * Feuille de détail d'une opération du « Suivi du mois » : montant, date, compte, catégorie, puis
 * « Fermer » / « Modifier ».
 *
 * Extraite de `app/(tabs)/pilotage.tsx` à l'identique. Deux subtilités du calcul d'affichage y sont
 * préservées telles quelles :
 *  • un virement vers un compte d'ÉPARGNE ou d'INVESTISSEMENT s'affiche en POSITIF — on se place du
 *    point de vue du compte de destination, où l'argent entre ;
 *  • le montant est converti dans la devise de RÉFÉRENCE de l'utilisateur, jamais dans celle du
 *    compte source (un compte en devise afficherait sinon un montant qui ne correspond à rien).
 */
import { useMemo } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLingeringValue } from '../../hooks/platform/useLingeringValue';
import { convertAmount, CURRENCY_SYMBOL, type RatesMap } from '../../lib/finance/currency';
import { sheetWidth } from '../../lib/ui/appLayout';
import type { AppColors } from '../../theme/palette';

interface Props {
  /** `null` = feuille fermée. Transaction enrichie telle que l'écran la manipule. */
  tx: any | null;
  onClose: () => void;
  /** Comptes du périmètre — servent à résoudre nom, devise et type du compte lié. */
  accounts: any[];
  rates: RatesMap;
  refCurrency: string;
  /** Identifiant de l'utilisateur courant : on ne propose « Modifier » que sur SES opérations. */
  userId: string | undefined;
  /** Marge basse de la feuille, barre système comprise (cf. useSheetBottomPadding). */
  sheetPad: number;
  colors: AppColors;
  onEdit: (route: string) => void;
}

export default function SuiviTxSheet({
  tx, onClose, accounts, rates, refCurrency, userId, sheetPad, colors, onEdit,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /* La feuille glisse pour sortir : son contenu doit survivre a l animation, sinon on voit une
     feuille VIDE glisser vers le bas (cf. useLingeringValue). */
  const shownTx = useLingeringValue(tx);

  return (
    <Modal visible={!!tx} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.txSheetOverlay} onPress={onClose}>
        <Pressable style={[styles.txSheet, { paddingBottom: sheetPad }]} onPress={() => {}}>
          {shownTx && (() => {
            const t = shownTx;
            const cur = accounts.find((a) => a.id === t.account_id)?.currency ?? refCurrency;
            const raw = Number(t.amount);
            const conv = convertAmount(Math.abs(raw), cur, refCurrency, rates) ?? Math.abs(raw);
            // Virement vers ÉPARGNE / INVESTISSEMENT : point de vue du compte de DESTINATION.
            const linkedType = accounts.find((a) => a.id === t.linked_account_id)?.type;
            const isToSavInv = linkedType === 'savings' || linkedType === 'investment';
            const isIncome = isToSavInv ? true : raw > 0;
            const dateStr = new Date(t._monthDate ?? t.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const isCredit = !!t.is_credit_flow;
            const isMine = !t.profile_id || t.profile_id === userId;
            const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            const canEdit = isMine && !!t.id && !t._perimeter_synthetic;
            const goEdit = () => {
              if (isCredit) { onEdit(`/(tabs)/comptes/credit/${t.credit_id}`); return; }
              onEdit(t.is_recurring
                ? `/(tabs)/transactions/edit/${t.id}?instanceDate=${monthKey}`
                : `/(tabs)/transactions/edit/${t.id}`);
            };
            const rows: [string, string][] = [
              ['Date', dateStr],
              ['Montant', `${isIncome ? '+' : '−'} ${conv.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL}`],
              ['Compte', accounts.find((a) => a.id === t.account_id)?.name ?? t.account?.name ?? ''],
            ];
            if (t.linked_account_id) rows.push(['Vers', accounts.find((a) => a.id === t.linked_account_id)?.name ?? '']);
            if (t.category?.name) rows.push(['Catégorie', t.category.name]);
            if (t._impact_pct != null && t._impact_pct < 100) rows.push(['Part appliquée', `${t._impact_pct} %`]);
            return (
              <>
                <View style={styles.txSheetHandle} />
                <Text style={[styles.txSheetAmount, { color: isIncome ? colors.green : colors.danger }]}>
                  {isIncome ? '+' : '−'} {conv.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                </Text>
                <Text style={styles.txSheetLabel}>{t.note?.trim() || t.category?.name || 'Virement'}</Text>
                <View style={styles.txSheetDivider} />
                {rows.map(([k, v]) => (
                  <View key={k} style={styles.txSheetRow}>
                    <Text style={styles.txSheetKey}>{k}</Text>
                    <Text style={styles.txSheetVal} numberOfLines={2}>{v}</Text>
                  </View>
                ))}
                <View style={styles.txSheetBtns}>
                  <TouchableOpacity style={styles.txSheetClose} onPress={onClose} accessibilityRole="button">
                    <Text style={styles.txSheetCloseText}>Fermer</Text>
                  </TouchableOpacity>
                  {(canEdit || isCredit) && (
                    <TouchableOpacity style={styles.txSheetEdit} onPress={goEdit} accessibilityRole="button">
                      <Ionicons name={isCredit ? 'card-outline' : 'create-outline'} size={16} color={colors.bg} />
                      <Text style={styles.txSheetEditText}>{isCredit ? 'Voir le crédit' : 'Modifier'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            );
          })()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Règles recopiées à l'identique depuis pilotage.tsx. */
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    txSheetOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
    txSheet: { ...sheetWidth, backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
    txSheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.cardBorder, marginBottom: 14 },
    txSheetAmount: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
    txSheetLabel: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginTop: 2 },
    txSheetDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 14 },
    txSheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
    txSheetKey: { fontSize: 13.5, color: c.textSecondary },
    txSheetVal: { fontSize: 13.5, fontWeight: '600', color: c.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
    txSheetBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
    txSheetClose: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    txSheetCloseText: { fontSize: 15, fontWeight: '700', color: c.text },
    txSheetEdit: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald },
    txSheetEditText: { fontSize: 15, fontWeight: '700', color: c.bg },
  });
}
