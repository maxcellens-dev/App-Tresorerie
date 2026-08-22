/**
 * Modal de DÉTAIL du « Suivi du mois » : ce qui s'ouvre au clic sur un montant du tableau de bord.
 *
 * Six clés, autant de vues. Cette modale faisait 675 lignes dans `app/(tabs)/pilotage.tsx`, avec 65
 * identifiants capturés par fermeture — ce n'était pas un déplacement mécanique comme les sept
 * autres modales, mais une refonte. Elle est découpée en sous-blocs indépendants
 * (`components/pilotage/detail/`), chacun ne recevant que ce qu'il affiche, et les FILTRES sont
 * descendus avec les vues qu'ils pilotent au lieu de remonter en état d'écran.
 *
 * La clé `planned` (« Dépenses prévues restantes », deux onglets) a été retirée : c'était le dernier
 * reste de la « vue complète », plus aucun chemin de l'app ne l'ouvrait depuis que la ligne « Tu
 * devrais encore dépenser » mène à `planned_simple`.
 *
 * Ce qui reste ici : la coquille, l'en-tête et l'aiguillage. Cf. docs/PLAN_REFACTOR_TESTS.md.
 */
import { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type RatesMap } from '../../lib/finance/currency';
import { semanticText, type AppColors } from '../../theme/palette';
import { useLingeringValue } from '../../hooks/platform/useLingeringValue';
import { makeDetailStyles } from './detail/detailStyles';
import { TxList, makeAmountResolvers, fmtAmount } from './detail/detailShared';
import SpentDetail from './detail/SpentDetail';
import PlannedSimpleDetail from './detail/PlannedSimpleDetail';
import RelykaDetail from './detail/RelykaDetail';

export type DetailKey = 'checking' | 'savings' | 'invest' | 'spent' | 'planned_simple' | 'relyka';

const TITLES: Record<DetailKey, string> = {
  checking: 'Budget courant actuel',
  savings: 'Épargne du mois',
  invest: 'Investissement du mois',
  spent: 'Dépensé ce mois',
  planned_simple: 'Ce qui va encore sortir',
  relyka: 'Ton Relyka (Budget libre)',
};

interface Props {
  detailKey: DetailKey | null;
  onClose: () => void;
  suiviDetail: {
    checking: any[]; savings: any[]; invest: any[]; spent: any[]; recurrentes: any[];
    recurringTotal: number; recurringPassed: number;
  };
  recurUpcoming: { amount: number; count: number; list: any[] };
  pilotageData: any;
  profile: any;
  accounts: any[];
  rates: RatesMap;
  catParentName: Record<string, string>;
  reservationsTotal: number;
  cumulsTotal: number;
  resteDisponible: number;
  relykaAffiche: number;
  troughDate: string | null;
  troughExplain: string;
  varMode: 'auto' | 'estimate' | 'real';
  onVarMode: (m: 'auto' | 'estimate' | 'real') => void;
  varModeDirty: boolean;
  savingVarMode: boolean;
  onSaveVarMode: () => void;
  /** Hauteur de lecture calée sur la FENÊTRE, et non figée : cf. `detailScrollMaxHeight`. */
  scrollMaxHeight: number;
  isDesktop: boolean;
  colors: AppColors;
  onPressTx: (t: any) => void;
  onShowRecurring: () => void;
  onShowTroughInfo: () => void;
  onEditEstimate: () => void;
  onSetMargin: () => void;
}

export default function DetailModal({
  detailKey, onClose, suiviDetail, recurUpcoming, pilotageData, profile, accounts,
  rates, catParentName, reservationsTotal, cumulsTotal, resteDisponible, relykaAffiche, troughDate,
  troughExplain, varMode, onVarMode, varModeDirty, savingVarMode, onSaveVarMode, scrollMaxHeight,
  isDesktop, colors, onPressTx, onShowRecurring, onShowTroughInfo, onEditEstimate, onSetMargin,
}: Props) {
  const styles = useMemo(() => makeDetailStyles(colors), [colors]);

  /* La vue affichée survit au fondu de SORTIE, et est présente dès le premier rendu à l'ENTRÉE —
     sans quoi on voit passer une carte vide dans un cas ou dans l'autre (cf. useLingeringValue). */
  const shownKey = useLingeringValue(detailKey);

  /* `openSeq` change à CHAQUE ouverture et sert de `key` aux sous-blocs : ils sont remontés à neuf,
     donc leurs filtres repartent de zéro. Sans lui, garder le contenu monté ferait survivre un
     filtre à une fermeture suivie d'une réouverture rapide — la règle qu'on tient explicitement.
     Ajusté PENDANT le rendu (et non dans un effet) pour la même raison que ci-dessus. */
  const [prevKey, setPrevKey] = useState<DetailKey | null>(detailKey);
  const [openSeq, setOpenSeq] = useState(0);
  if (detailKey !== prevKey) {
    setPrevKey(detailKey);
    if (detailKey) setOpenSeq((n) => n + 1);
  }

  return (
    <Modal visible={detailKey !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.detailOverlay} onPress={onClose}>
        <Pressable style={[styles.detailBox, isDesktop && styles.detailBoxDesktop]} onPress={() => {}}>
          {shownKey && pilotageData && (() => {
            const detailKey = shownKey; // la vue affichée, qui survit au fondu de sortie
            const refCode = profile?.currency_code ?? 'EUR';
            const { toRef, toRefAmt } = makeAmountResolvers(accounts, refCode, rates, pilotageData);
            // Dépensé récurrent / variable du mois (mêmes valeurs que les curseurs « dont … »).
            const recurSpentMonth = Math.min(suiviDetail.recurringTotal ?? 0, suiviDetail.recurringPassed ?? 0);
            // Même source unique que le curseur « dont variables » (cf. `varSpent`).
            const varSpentMonth = pilotageData.variable_envelope_spent
              ?? Math.max(0, (pilotageData.month_expenses_past ?? 0) - recurSpentMonth);
            /* Lignes tapables (→ détail de la transaction) dans TOUS les modaux de suivi : épargné,
               investi, total dépensé et dépenses prévues/récurrentes (§3). */
            const rowsTappable = detailKey === 'savings' || detailKey === 'invest' || detailKey === 'spent';

            return (
              <>
                <View style={styles.detailHeader}>
                  <Text style={[styles.detailTitle, isDesktop && styles.detailTitleDesktop]}>
                    {TITLES[detailKey]}
                  </Text>
                  {/* Raccourci « toutes les récurrentes » : seulement sur « ce qui va encore
                      sortir », où il complète la lecture. Dans « Dépensé ce mois », il envoyait
                      vers une liste de MODÈLES alors qu'on regarde des opérations passées. */}
                  {detailKey === 'planned_simple' && (
                    <TouchableOpacity onPress={onShowRecurring} style={{ padding: 4, marginRight: 2 }} accessibilityLabel="Toutes les transactions récurrentes">
                      <Ionicons name="repeat" size={20} color={colors.orange} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4 }}>
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: scrollMaxHeight }} showsVerticalScrollIndicator={false}>
                  {detailKey === 'checking' && (
                    <>
                      {suiviDetail.checking.map((a) => (
                        <View key={a.id} style={styles.detailRow}>
                          <Text style={[styles.detailRowLabel, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                          <Text style={[styles.detailRowValue, { color: colors.text }]}>{fmtAmount(Number(a.balance))}</Text>
                        </View>
                      ))}
                      {(pilotageData.month_income_remaining ?? 0) > 0 && (
                        <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: colors.cardBorder }]}>
                          <Text style={[styles.detailRowLabel, { flex: 1 }]}>Recettes prévues restantes</Text>
                          <Text style={[styles.detailRowValue, { color: colors.green }]}>+{fmtAmount(pilotageData.month_income_remaining)}</Text>
                        </View>
                      )}
                    </>
                  )}

                  {detailKey === 'savings' && (
                    <TxList
                      list={suiviDetail.savings} color={semanticText(colors.green, colors)}
                      empty="Aucun virement d'épargne ce mois." tappable={rowsTappable}
                      onPressTx={onPressTx} toRef={toRef} colors={colors} styles={styles}
                    />
                  )}

                  {detailKey === 'invest' && (
                    <TxList
                      list={suiviDetail.invest} color={semanticText(colors.violet, colors)}
                      empty="Aucun virement d'investissement ce mois." tappable={rowsTappable}
                      onPressTx={onPressTx} toRef={toRef} colors={colors} styles={styles}
                    />
                  )}

                  {detailKey === 'spent' && (
                    <SpentDetail
                      key={openSeq}
                      spent={suiviDetail.spent} recurUpcoming={recurUpcoming}
                      catParentName={catParentName} toRef={toRef} toRefAmt={toRefAmt}
                      onPressTx={onPressTx} isDesktop={isDesktop} colors={colors} styles={styles}
                    />
                  )}

                  {detailKey === 'planned_simple' && (
                    <PlannedSimpleDetail
                      key={openSeq}
                      pilotageData={pilotageData} recurUpcoming={recurUpcoming}
                      varSpentMonth={varSpentMonth} varMode={varMode} onVarMode={onVarMode}
                      varModeDirty={varModeDirty} savingVarMode={savingVarMode}
                      onSaveVarMode={onSaveVarMode} onEditEstimate={onEditEstimate}
                      onPressTx={onPressTx} toRefAmt={toRefAmt} colors={colors} styles={styles}
                    />
                  )}

                  {detailKey === 'relyka' && (
                    <RelykaDetail
                      key={openSeq}
                      pilotageData={pilotageData} recurringTotal={suiviDetail.recurringTotal}
                      varSpentMonth={varSpentMonth} reservationsTotal={reservationsTotal}
                      cumulsTotal={cumulsTotal} resteDisponible={resteDisponible}
                      relykaAffiche={relykaAffiche} troughDate={troughDate}
                      troughExplain={troughExplain} onShowTroughInfo={onShowTroughInfo}
                      onSetMargin={onSetMargin} colors={colors} styles={styles}
                    />
                  )}
                </ScrollView>
              </>
            );
          })()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
