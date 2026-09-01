/**
 * « Ce qui va encore sortir » (vue simplifiée) — une seule question : ce qui quittera le compte
 * d'ici la fin du mois, c'est-à-dire les dépenses variables estimées ET les récurrentes pas encore
 * prélevées.
 *
 * MISE EN FORME : le modal s'ouvre sur UNE addition. Le total flottait auparavant en tête, sur une
 * ligne de tableau identique à toutes les autres, et ses deux termes arrivaient bien plus bas,
 * séparés par tout le réglage de l'enveloppe : rien ne disait que l'un était la somme des autres.
 * Ils sont désormais posés ensemble dans la carte du haut — colonne d'opérateurs (« + ») à gauche,
 * montants alignés à droite, sous le total. Le reste du modal DÉVELOPPE ces deux termes, dans le
 * même ordre et sous les mêmes libellés.
 *
 * ⚠️ À ne pas confondre avec `PlannedDetail` (branche `planned` de la vue détaillée), qui répond à
 * une AUTRE question et reste séparé pour cette raison.
 *
 * Aucun bouton de renvoi en pied (« Voir toutes mes récurrentes », « Répartition par catégorie ») :
 * la liste complète des récurrentes reste à un tap, par l'icône ↻ de l'entête du modal.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { contrastRatio, darken, lighten, readableOn, semanticText, type AppColors } from '../../../theme/palette';
import AppButton from '../../ui/AppButton';
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
  /* Dépenses variables DÉJÀ SAISIES pour les jours à venir : sorties du calcul de l'estimation
     (elles pèsent déjà sur le Relyka via le point bas), elles doivent rester VISIBLES ici — c'est
     de l'argent qui va sortir, et le total du modal doit retomber sur la ligne du tableau de bord. */
  const varPlanned = Math.max(0, pilotageData.variable_envelope_planned ?? 0);
  const recurLeft = Math.max(0, recurUpcoming.amount);
  /* DEUX termes, jamais trois : les variables « déjà saisies » sont des dépenses variables comme
     les autres, elles rejoignent donc le même terme (et sont détaillées dans son bloc). Sans ça,
     l'addition du haut changeait de forme d'un mois à l'autre. */
  const varTotal = varLeft + varPlanned;
  const total = varTotal + recurLeft;
  /* CONTEXTE de l'enveloppe variable. Sans lui, la ligne affichait « 0 € » sans rien qui
     l'explique : l'enveloppe était simplement déjà consommée, mais ni le montant estimé ni ce qui
     avait été dépensé n'apparaissaient nulle part. */
  const varEnvelope = Math.max(0, pilotageData.variable_envelope_initial ?? 0);
  const varUsed = Math.max(0, varSpentMonth);
  /* La BARRE mesure ce que l'enveloppe a déjà absorbé : le dépensé ET ce qui est déjà saisi pour la
     fin de la période. Sans cette seconde part, elle pouvait rester à moitié pleine alors qu'il ne
     restait plus rien à prévoir — la ligne « Reste » disait 0 et la barre le contredisait. */
  const varConsumed = varUsed + varPlanned;
  const varRatio = varEnvelope > 0 ? Math.min(1, varConsumed / varEnvelope) : 0;
  const varExhausted = varEnvelope > 0 && varConsumed >= varEnvelope;
  const orange = semanticText(colors.orange, colors);
  const barColor = varExhausted ? semanticText(colors.danger, colors) : orange;

  /* Rond d'ENCRE de l'action « Modifier l'estimation » — même fabrique que « Modifier budgets »
     (components/budget/BudgetsView) : on éclaircit le haut d'un rond noir, on assombrit le bas d'un
     rond blanc, la lumière vient toujours d'en haut. */
  const actionInk = colors.text;
  const actionGradient: [string, string] = colors.mode === 'light'
    ? [lighten(actionInk, 0.24), actionInk]
    : [actionInk, darken(actionInk, 0.16)];
  const actionIconColor = contrastRatio(colors.bg, actionInk) >= 4.5 ? colors.bg : readableOn(actionInk);

  return (
    <View style={{ paddingTop: 4 }}>
      {/* ── L'ADDITION ─────────────────────────────────────────────────────────────────────────
          Le total, puis ses deux termes juste dessous, sous un filet : c'est la seule chose à
          comprendre en ouvrant ce modal. */}
      <View style={styles.sumCard}>
        <View style={styles.sumHead}>
          <Text style={styles.sumLabel}>Total à venir</Text>
          <Text style={[styles.sumTotal, { color: orange }]}>{fmtAmount(total)}</Text>
        </View>

        <View style={styles.sumRule} />

        {/* Libellés COURTS, sur une ligne : une addition qui se replie sur deux lignes cesse de
            se lire comme une addition. Les sections qui les développent portent l'icône et le
            même montant, c'est ce qui fait le lien. */}
        <View style={styles.sumRow}>
          <View style={styles.sumLead}>
            <View style={styles.sumOp} />
            <Ionicons name="cart-outline" size={15} color={colors.textSecondary} />
          </View>
          <Text style={styles.sumRowLabel} numberOfLines={1}>Dépenses variables</Text>
          <Text style={[styles.sumRowValue, { color: orange }]}>{fmtAmount(varTotal)}</Text>
        </View>

        <View style={styles.sumRow}>
          <View style={styles.sumLead}>
            <View style={styles.sumOp}>
              <Ionicons name="add" size={13} color={colors.textSecondary} />
            </View>
            <Ionicons name="repeat" size={15} color={colors.textSecondary} />
          </View>
          <Text style={styles.sumRowLabel} numberOfLines={1}>Récurrentes à venir</Text>
          <Text style={[styles.sumRowValue, { color: orange }]}>{fmtAmount(recurLeft)}</Text>
        </View>
      </View>

      {/* ── TERME 1 : LES DÉPENSES VARIABLES ─────────────────────────────────────────────────── */}
      <View style={styles.sectionHead}>
        <Ionicons name="cart-outline" size={16} color={colors.text} />
        <Text style={styles.sectionTitle}>Dépenses variables</Text>
        <Text style={styles.sectionAmount}>{fmtAmount(varTotal)}</Text>
      </View>
      {varPlanned > 0 && (
        <Text style={styles.sectionSub}>
          Dont {fmtAmount(varPlanned)} déjà saisis, datés d’ici la fin de la période — ils sont déjà
          comptés dans ton Relyka.
        </Text>
      )}

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
              <Text style={[styles.envInlineVal, { color: varLeft > 0 ? orange : colors.textSecondary }]}>{fmtAmount(varLeft)}</Text>
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
      {(varEnvelope <= 0 || varExhausted) && (
        <Text style={styles.detailNote}>
          {varEnvelope <= 0
            ? `Aucun budget variable habituel n'est encore estimé : tant qu'il vaut ${fmtAmount(0)}, Relyka ne prévoit aucune dépense variable pour la fin du mois. Indique ton estimation pour que le calcul démarre.`
            : `Enveloppe déjà consommée (${fmtAmount(varConsumed)} sur ${fmtAmount(varEnvelope)}${varPlanned > 0 ? `, dont ${fmtAmount(varPlanned)} déjà saisis pour les jours à venir` : ''}) : c'est pour ça qu'il ne reste rien à prévoir de ce côté.`}
        </Text>
      )}

      {/* Action SECONDAIRE : elle ouvre un écran, elle ne conclut pas une saisie. D'où la tuile à
          nu (rond d'encre + libellé) plutôt qu'un bouton encadré pleine largeur, qui réclamait une
          bande entière du modal pour lui seul. « Enregistrer » — lui, une vraie validation — garde
          son bouton plein, à côté. */}
      <View style={styles.varModeActions}>
        <TouchableOpacity
          style={styles.inkTile}
          activeOpacity={0.7}
          onPress={onEditEstimate}
          accessibilityRole="button"
          accessibilityLabel="Modifier mon estimation"
        >
          <LinearGradient
            colors={actionGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.inkTileIcon}
          >
            <Ionicons name="create-outline" size={14} color={actionIconColor} />
          </LinearGradient>
          <Text style={styles.inkTileLabel} numberOfLines={1}>Modifier l'estimation</Text>
        </TouchableOpacity>
        {/* LE bouton de l'app (components/ui/AppButton) : hauteur fixe, ombre teintée, voile
            d'appui. Il était refait à la main ici — un aplat vert sans rien de tout ça, qui ne
            ressemblait à aucun autre « Enregistrer » de l'app. */}
        {varModeDirty && (
          <AppButton
            label="Enregistrer"
            icon="checkmark"
            size="sm"
            loading={savingVarMode}
            onPress={onSaveVarMode}
          />
        )}
      </View>

      <View style={[styles.suiviDivider, { marginTop: 12 }]} />

      {/* ── TERME 2 : LES RÉCURRENTES ────────────────────────────────────────────────────────── */}
      <View style={styles.sectionHead}>
        <Ionicons name="repeat" size={16} color={colors.text} />
        <Text style={styles.sectionTitle}>
          Récurrentes pas encore passées
          {recurUpcoming.count > 0 ? ` (${recurUpcoming.count})` : ''}
        </Text>
        <Text style={styles.sectionAmount}>{fmtAmount(recurLeft)}</Text>
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
