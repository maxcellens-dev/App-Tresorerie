/**
 * « Ton Relyka » — le détail du CALCUL : point bas de trésorerie, ce qu'il englobe déjà, puis les
 * quatre déductions qui donnent le budget libre.
 *
 * C'est ici, et pas ailleurs, que l'utilisateur rencontre pour la première fois « réservé »,
 * « enveloppe variable » et « marge de sécurité » : chaque déduction porte donc sa fiche
 * d'explication (`InfoDot`).
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import InfoDot from '../../ui/InfoDot';
import type { GlossaryTerm } from '../../../lib/ui/glossary';
import { semanticText, type AppColors } from '../../../theme/palette';
import { shortDay } from '../../../lib/finance/pilotageView';
import { floorToTen } from '../../../lib/finance/currency';
import type { DetailStyles } from './detailStyles';
import { fmtAmount } from './detailShared';

interface Props {
  pilotageData: any;
  /** Total des récurrentes du mois — déjà compris dans le point bas, affiché en info. */
  recurringTotal: number;
  varSpentMonth: number;
  reservationsTotal: number;
  cumulsTotal: number;
  resteDisponible: number;
  /** Relyka tel qu'affiché sur la carte (dizaine inférieure). */
  relykaAffiche: number;
  /**
   * Fourchette de la carte quand la confiance n'est pas haute. Le détail montre le CALCUL, donc un
   * chiffre exact — mais l'annoncer sans un mot revenait à contredire la carte, qui vient de dire
   * que ce montant est une estimation. On rappelle ici d'où vient l'écart.
   */
  relykaRange?: { low: number; high: number; isRange: boolean } | null;
  /**
   * D'OÙ VIENT LA FOURCHETTE, en clair. Sans ça, « estimation » est une affirmation sans preuve :
   * on lit une fourchette large en étant convaincu que tout est à jour, et rien ne dit ni depuis
   * quand l'app attend une vérification, ni combien d'euros elle met en doute.
   */
  relykaDoubt?: { uncertaintyEur: number; lastVerifiedAt: string | null } | null;
  troughDate: string | null;
  troughExplain: string;
  onShowTroughInfo: () => void;
  /** Ferme le modal puis ouvre la saisie de la marge de sécurité. */
  onSetMargin: () => void;
  colors: AppColors;
  styles: DetailStyles;
}

export default function RelykaDetail({
  pilotageData, recurringTotal, varSpentMonth, reservationsTotal, cumulsTotal, resteDisponible,
  relykaAffiche, relykaRange, relykaDoubt, troughDate, troughExplain, onShowTroughInfo, onSetMargin,
  colors, styles,
}: Props) {
  const sFut = pilotageData.month_savings_future ?? 0;
  const iFut = pilotageData.month_invest_future ?? 0;
  /* Le point bas ENGLOBE déjà : dépenses récurrentes du mois, dépenses variables déjà dépensées, et
     épargne/invest déjà réalisés (sorties du solde courant). On les affiche en INFO (gris) pour que
     le user voie tout, puis on déduit ce qui n'y est pas encore. */
  const eiRealises = Math.max(0, (pilotageData.month_savings_total ?? 0) - sFut)
    + Math.max(0, (pilotageData.month_invest_total ?? 0) - iFut);
  /* Les dépenses variables DÉJÀ SAISIES pour les jours à venir sont, elles aussi, comprises dans le
     point bas (il rejoue les opérations jour après jour). C'est la raison pour laquelle l'estimation
     ci-dessous ne les provisionne plus : sans cette ligne, on croirait qu'elles ont disparu. */
  const varPlanned = Math.max(0, pilotageData.variable_envelope_planned ?? 0);
  const infos = [
    { l: 'Dépenses récurrentes', v: recurringTotal ?? 0 },
    { l: 'Dépenses variables déjà dépensées', v: varSpentMonth },
    ...(varPlanned > 0 ? [{ l: 'Dépenses variables déjà saisies (à venir)', v: varPlanned }] : []),
    { l: 'Épargne & investissement réalisés', v: eiRealises },
  ];
  const deductions: { l: string; v: number; term?: GlossaryTerm }[] = [
    { l: 'Épargne & investissement à venir', v: sFut + iFut },
    { l: 'Dépenses variables restantes (estimées)', v: pilotageData.variable_envelope_remaining ?? 0, term: 'enveloppe_variable' },
    { l: 'Somme réservée', v: (pilotageData.monthly_reserve_planned ?? 0) + reservationsTotal + cumulsTotal, term: 'reserve' },
    { l: 'Marge de sécurité', v: pilotageData.safety_margin_amount ?? 0, term: 'marge_securite' },
  ];
  const pointBas = pilotageData.cashflow_trough ?? pilotageData.current_checking_balance ?? 0;

  return (
    <View>
      {/* Point bas (trajectoire) + DATE + note */}
      <View style={styles.detailRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
          <Text style={styles.detailRowLabel}>
            Point bas de trésorerie
            {troughDate ? <Text style={styles.detailRowSub}>{`  · ${shortDay(troughDate)}`}</Text> : null}
          </Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="En savoir plus" onPress={onShowTroughInfo} hitSlop={8}>
            <Ionicons name="information-circle-outline" size={16} color={colors.emerald} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.detailRowValue, { color: colors.text }]}>{fmtAmount(pointBas)}</Text>
      </View>
      {/* Ce que ce point bas VEUT DIRE : jusqu'à quand le Relyka est contraint, et ce qui le fera
          remonter. C'est la phrase qui évite le « c'est faux ». */}
      {!!troughExplain && (
        <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 2, lineHeight: 17 }]}>{troughExplain}</Text>
      )}
      {/* Déjà compris dans le point bas (info, non redéduit) */}
      <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 2, marginBottom: 2 }]}>Déjà compris dans le point bas :</Text>
      {infos.map((r) => (
        <View key={r.l} style={[styles.detailRow, { paddingVertical: 3 }]}>
          <Text style={[styles.detailRowSub, { flex: 1, paddingLeft: 12 }]} numberOfLines={1}>· {r.l}</Text>
          <Text style={styles.detailRowSub}>{fmtAmount(r.v)}</Text>
        </View>
      ))}
      {/* Déduits du point bas pour donner le Relyka */}
      <View style={{ height: 8 }} />
      {deductions.map((r) => (
        <View key={r.l} style={styles.detailRow}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.detailRowLabel}>{r.l}</Text>
            {!!r.term && <InfoDot term={r.term} size={14} />}
          </View>
          <Text style={[styles.detailRowValue, { color: colors.textSecondary }]}>{r.v > 0 ? '− ' + fmtAmount(r.v) : fmtAmount(0)}</Text>
        </View>
      ))}
      {/* Marge non définie : on ne laisse pas un « − 0 € » muet. On dit ce que ça implique (le
          Relyka est optimiste) et on offre de la définir. */}
      {(pilotageData.safety_margin_amount ?? 0) <= 0 && (
        <TouchableOpacity style={styles.marginNudge} activeOpacity={0.8} onPress={onSetMargin}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.blue} />
          <Text style={styles.marginNudgeText}>
            Tu as une marge de sécurité à {fmtAmount(0)}. Il vaut mieux toujours garder une somme de côté sur tes comptes courants pour les imprévus.
          </Text>
          <Ionicons name="chevron-forward" size={15} color={colors.blue} />
        </TouchableOpacity>
      )}
      <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: colors.cardBorder, marginTop: 4 }]}>
        <Text style={[styles.detailRowLabel, { flex: 1, fontWeight: '800' }]}>Ton Relyka</Text>
        <Text style={[styles.detailRowValue, { color: semanticText(colors.emerald, colors), fontWeight: '800' }]}>{fmtAmount(resteDisponible)}</Text>
      </View>
      {/* La carte affiche la dizaine INFÉRIEURE : sans cette ligne, le détail (19 €) semblait
          contredire le chiffre mis en avant (10 €). */}
      {relykaAffiche !== Math.round(resteDisponible) && (
        <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 4 }]}>
          {`Arrondi à ${fmtAmount(relykaAffiche)} sur le tableau de bord (dizaine inférieure).`}
        </Text>
      )}
      {/* Le détail donne un chiffre EXACT — alors que la carte vient d'annoncer une fourchette.
          Sans ce rappel, l'écran se contredit : « estimation » d'un côté, montant au centime de
          l'autre. On dit d'où vient l'écart, et ce qui le referme. */}
      {relykaRange?.isRange && (
        <Text style={[styles.detailRowSub, { paddingLeft: 4, marginTop: 4, lineHeight: 17 }]}>
          {`Ce calcul suppose que TOUTES tes dépenses sont saisies. Tant que ton solde n'est pas vérifié, le tableau de bord annonce ${
            /* Le chiffre CITÉ ici doit être celui que le tableau de bord affiche vraiment —
               dizaine inférieure, comme la carte (cf. PilotageSimple). Sinon ce paragraphe, qui
               explique justement l'écart entre la carte et le détail, en introduit un nouveau. */
            floorToTen(relykaRange.low) > 0
              ? `un minimum sûr de ${fmtAmount(floorToTen(relykaRange.low))}`
              : `ce montant comme un maximum`
          }.`}
          {relykaDoubt
            ? ` Relyka met ${fmtAmount(relykaDoubt.uncertaintyEur)} en doute${
                relykaDoubt.lastVerifiedAt
                  ? `, faute de solde vérifié depuis le ${shortDay(relykaDoubt.lastVerifiedAt)}`
                  : ', faute de solde jamais vérifié'
              }.`
            : ''}
        </Text>
      )}
    </View>
  );
}
