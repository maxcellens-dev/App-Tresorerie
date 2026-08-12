/**
 * « Ce qui va encore sortir » (vue simplifiée) — une seule question : ce qui quittera le compte
 * d'ici la fin du mois, c'est-à-dire les dépenses variables estimées ET les récurrentes pas encore
 * prélevées.
 *
 * ⚠️ À ne pas confondre avec `PlannedDetail` (branche `planned` de la vue détaillée), qui répond à
 * une AUTRE question et reste séparé pour cette raison.
 *
 * Aucun bouton de renvoi en pied (« Voir toutes mes récurrentes », « Répartition par catégorie ») :
 * la liste complète des récurrentes reste à un tap, par l'icône ↻ de l'entête du modal.
 */
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { semanticText, type AppColors } from '../../../theme/palette';
import { iconForTransaction } from '../../../lib/ui/categoryIcons';
import type { DetailStyles } from './detailStyles';
import { fmtAmount, shortDate, rowLabel } from './detailShared';

interface Props {
  pilotageData: any;
  recurUpcoming: { amount: number; count: number; list: any[] };
  /** Dépensé VARIABLE du mois — même source unique que le curseur « dont variables ». */
  varSpentMonth: number;
  varMode: 'auto' | 'estimate' | 'real';
  onVarMode: (m: 'auto' | 'estimate' | 'real') => void;
  varModeDirty: boolean;
  savingVarMode: boolean;
  onSaveVarMode: () => void;
  /** Ouvre la SAISIE de l'estimation (le modal se ferme d'abord). */
  onEditEstimate: () => void;
  onPressTx: (t: any) => void;
  toRefAmt: (amt: number, accountId: string) => number;
  colors: AppColors;
  styles: DetailStyles;
}

export default function PlannedSimpleDetail({
  pilotageData, recurUpcoming, varSpentMonth, varMode, onVarMode, varModeDirty, savingVarMode,
  onSaveVarMode, onEditEstimate, onPressTx, toRefAmt, colors, styles,
}: Props) {
  const varLeft = Math.max(0, pilotageData.variable_envelope_remaining ?? 0);
  const recurLeft = Math.max(0, recurUpcoming.amount);
  /* CONTEXTE de l'enveloppe variable. Sans lui, la ligne affichait « 0 € » sans rien qui
     l'explique : l'enveloppe était simplement déjà consommée, mais ni le montant estimé ni ce qui
     avait été dépensé n'apparaissaient nulle part. */
  const varEnvelope = Math.max(0, pilotageData.variable_envelope_initial ?? 0);
  const varUsed = Math.max(0, varSpentMonth);
  const varRatio = varEnvelope > 0 ? Math.min(1, varUsed / varEnvelope) : 0;
  const varExhausted = varEnvelope > 0 && varUsed >= varEnvelope;
  const barColor = varExhausted ? semanticText(colors.danger, colors) : semanticText(colors.orange, colors);

  return (
    <View style={{ gap: 6, paddingTop: 4 }}>
      <View style={styles.detailRow}>
        <Text style={[styles.detailRowLabel, { flex: 1 }]}>Total à venir</Text>
        <Text style={[styles.detailRowValue, { color: semanticText(colors.yellow, colors) }]}>{fmtAmount(varLeft + recurLeft)}</Text>
      </View>

      <View style={styles.suiviDivider} />

      <View style={styles.detailRow}>
        <Text style={[styles.detailRowLabel, { flex: 1 }]}>Dépenses variables estimées</Text>
        <Text style={[styles.detailRowValue, { color: semanticText(colors.orange, colors) }]}>{fmtAmount(varLeft)}</Text>
      </View>

      {/* D'où sort ce chiffre — version COMPACTE : une barre, et l'enveloppe / le dépensé / le
          reste sur UNE ligne au lieu de trois. Le modal tenait sur deux écrans de haut ; il tient
          maintenant d'un coup d'œil. */}
      {(varEnvelope > 0 || varUsed > 0) && (
        <View style={styles.envBlock}>
          {varEnvelope > 0 && (
            <View style={styles.envBarTrack}>
              <View style={[styles.envBarFill, { width: `${Math.round(varRatio * 100)}%`, backgroundColor: barColor }]} />
            </View>
          )}
          <View style={styles.envInline}>
            <View style={styles.envInlineItem}>
              <Text style={styles.envInlineLabel}>Enveloppe</Text>
              <Text style={[styles.envInlineVal, { color: varEnvelope > 0 ? colors.text : colors.textSecondary }]}>
                {varEnvelope > 0 ? fmtAmount(varEnvelope) : '—'}
              </Text>
            </View>
            <View style={styles.envInlineItem}>
              <Text style={styles.envInlineLabel}>Dépensé</Text>
              <Text style={[styles.envInlineVal, { color: barColor }]}>{fmtAmount(varUsed)}</Text>
            </View>
            <View style={styles.envInlineItem}>
              <Text style={styles.envInlineLabel}>Reste</Text>
              <Text style={[styles.envInlineVal, { color: varLeft > 0 ? semanticText(colors.orange, colors) : colors.textSecondary }]}>{fmtAmount(varLeft)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── D'OÙ VIENT L'ENVELOPPE : le choix appartient à l'utilisateur ──────────────────────────
          L'app décidait seule (réel dès 2 mois, sinon estimation). On expose les trois positions,
          avec la valeur de CHACUNE : on voit immédiatement ce qu'on gagnerait ou perdrait à
          basculer, au lieu de le deviner. */}
      <View style={styles.varModeRow}>
        {([
          ['auto', 'Auto', pilotageData.variable_real_available ? pilotageData.variable_real_value : pilotageData.variable_estimate_value],
          ['estimate', 'Estimation', pilotageData.variable_estimate_value],
          // « Calculé » et non « Réel » : c'est une MOYENNE de tes mois passés, pas ce que tu as
          // dépensé ce mois-ci. « Réel » laissait croire à un relevé du mois en cours.
          ['real', 'Calculé', pilotageData.variable_real_value],
        ] as [ 'auto' | 'estimate' | 'real', string, number ][]).map(([key, label, value]) => {
          const on = varMode === key;
          const unavailable = key === 'real' && !pilotageData.variable_real_available;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.varModeChip, on && styles.varModeChipOn, unavailable && { opacity: 0.45 }]}
              onPress={() => !unavailable && onVarMode(key)}
              disabled={unavailable}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={[styles.varModeLabel, on && styles.varModeLabelOn]}>{label}</Text>
              <Text style={[styles.varModeValue, on && styles.varModeLabelOn]}>
                {unavailable ? '2 mois requis' : value > 0 ? fmtAmount(value) : '—'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* D'où sort le chiffre du mode ACTIF — la question qu'on se pose en voyant trois montants
          différents côte à côte. */}
      <Text style={styles.detailNote}>
        {varMode === 'auto'
          ? (pilotageData.variable_real_available
              ? `Auto : dès que tu as 2 mois complets, Relyka bascule sur le calculé — ici la moyenne de tes ${pilotageData.variable_real_months} derniers mois (hors mois non clôturés).`
              : 'Auto : tant que tu n’as pas 2 mois complets derrière toi, Relyka s’en tient à ton estimation. Il passera au calculé tout seul ensuite.')
          : varMode === 'real'
          ? `Calculé : moyenne de tes ${pilotageData.variable_real_months} derniers mois de dépenses variables (les mois non clôturés sont exclus).`
          : 'Estimation : le montant que tu as déclaré toi-même (ton budget hebdomadaire ramené au mois).'}
      </Text>
      <Text style={styles.detailNote}>
        {varEnvelope <= 0
          ? 'Aucun budget variable habituel n\'est encore estimé : tant qu\'il vaut 0 €, Relyka ne prévoit aucune dépense variable pour la fin du mois. Indique ton estimation pour que le calcul démarre.'
          : varExhausted
          ? `Enveloppe déjà consommée (${fmtAmount(varUsed)} sur ${fmtAmount(varEnvelope)}) : c'est pour ça qu'il ne reste rien à prévoir de ce côté.`
          : ''}
      </Text>

      <View style={styles.varModeActions}>
        <TouchableOpacity style={styles.detailEditBtn} activeOpacity={0.7} onPress={onEditEstimate}>
          <Ionicons name="create-outline" size={15} color={colors.emerald} />
          <Text style={styles.detailEditBtnText}>Modifier l'estimation</Text>
        </TouchableOpacity>
        {varModeDirty && (
          <TouchableOpacity
            style={styles.varModeSave}
            activeOpacity={0.85}
            onPress={onSaveVarMode}
            disabled={savingVarMode}
          >
            {savingVarMode
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <><Ionicons name="checkmark" size={15} color={colors.bg} /><Text style={styles.varModeSaveText}>Enregistrer</Text></>}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.suiviDivider} />

      <View style={styles.detailRow}>
        <Text style={[styles.detailRowLabel, { flex: 1 }]}>
          Récurrentes pas encore passées
          {recurUpcoming.count > 0 ? ` (${recurUpcoming.count})` : ''}
        </Text>
        <Text style={[styles.detailRowValue, { color: semanticText(colors.orange, colors) }]}>{fmtAmount(recurLeft)}</Text>
      </View>
      {recurUpcoming.count === 0 ? (
        <Text style={styles.detailNote}>
          Toutes tes dépenses récurrentes du mois sont déjà passées.
        </Text>
      ) : (
        recurUpcoming.list.map((t: any, i: number) => (
          <TouchableOpacity key={t.id ?? i} style={styles.detailRow} activeOpacity={0.7} onPress={() => onPressTx(t)}>
            <Ionicons name={iconForTransaction(t) as any} size={16} color={colors.textSecondary} style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailRowLabel} numberOfLines={1}>{rowLabel(t)}</Text>
              <Text style={styles.detailRowSub}>{shortDate(t._monthDate ?? t.date)} · à venir</Text>
            </View>
            <Text style={[styles.detailRowValue, { color: colors.textSecondary }]}>
              {fmtAmount(toRefAmt(t._left ?? 0, t.account_id))}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
