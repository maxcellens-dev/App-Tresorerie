// Slide 1 « Ton Relyka » — graphique en COLONNES (remplace le donut/jauge).
// Une colonne par type de recommandation, proportionnelle à son montant recommandé.
//   • segment « déjà fait ce mois » (teinte plus foncée) en bas de colonne ;
//   • en confiance moyenne/basse : partie pleine = minimum sûr (borne basse), partie claire
//     = marge « selon vérification » (jusqu'à la borne haute) ;
//   • colonnes tapables → détail de la reco.
// Montants de fourchette arrondis à la dizaine INFÉRIEURE (cohérent avec l'affichage historique).
import { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';

export interface RelykaColumn {
  key: string;
  label: string;
  /** Montant recommandé (reste à allouer). */
  amount: number;
  color: string;
  /** Déjà réalisé ce mois pour ce type (chiffre RÉEL, toujours net). */
  done?: number;
  /** Fourchette du montant recommandé selon la confiance (Phase 3). */
  range?: { low: number; high: number; isRange: boolean };
}

interface Props {
  relykaAmount: number;
  relykaRange?: { low: number; high: number; isRange: boolean };
  relykaColor?: string;
  columns: RelykaColumn[];
  onColumnPress?: (index: number) => void;
  onCenterPress?: () => void;
}

const CHART_H = 112;

/** Assombrit une couleur hex (#RRGGBB) vers le noir (facteur 0..1). */
function darken(hex: string, f: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const g = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f)).toString(16).padStart(2, '0');
  return `#${g(1)}${g(3)}${g(5)}`;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('fr-FR');

// Animation jouée une seule fois par SESSION d'app (réinitialisé au relancement de l'app).
let hasAnimatedThisSession = false;

export default function RelykaColumns({
  relykaAmount, relykaRange, relykaColor, columns, onColumnPress, onCenterPress,
}: Props) {
  const c = useAppColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  // Animation « pousse » des colonnes : UNIQUEMENT à la première ouverture de l'app (par session).
  // Revenir sur la page ne rejoue pas l'animation ; fermer/rouvrir l'app la rejoue (module rechargé).
  const grow = useRef(new Animated.Value(hasAnimatedThisSession ? 1 : 0)).current;
  useEffect(() => {
    if (hasAnimatedThisSession) return;
    hasAnimatedThisSession = true;
    Animated.spring(grow, { toValue: 1, useNativeDriver: false, tension: 40, friction: 9 }).start();
  }, [grow]);
  const gh = (h: number) => grow.interpolate({ inputRange: [0, 1], outputRange: [0, h] });

  const maxVal = Math.max(
    1,
    ...columns.map((col) => (col.range?.high ?? col.amount) + (col.done ?? 0)),
  );
  const anyDone = columns.some((col) => (col.done ?? 0) > 0);
  const anyRange = !!relykaRange?.isRange || columns.some((col) => col.range?.isRange);

  // LE CHIFFRE PRINCIPAL EST TOUJOURS LE RELYKA — jamais une borne de fourchette.
  //
  // Avant, en confiance moyenne/basse, le montant était remplacé par la fourchette (« jusqu'à
  // 2 300 € » pour un Relyka de 1 266 €). Résultat : l'écran annonçait un nombre que son propre
  // détail contredisait, et supérieur à ce dont l'utilisateur dispose réellement — exactement
  // l'inverse du but recherché. L'incertitude reste montrée, mais par les canaux qui ne mentent
  // pas sur le montant : le badge « Estimation », la partie claire des colonnes (« si tout est à
  // jour ») et sa légende, plus le bandeau ambre « Vérifier ».
  const bigLabel = `${fmtInt(relykaAmount)} ${CURRENCY_SYMBOL}`;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity activeOpacity={onCenterPress ? 0.7 : 1} disabled={!onCenterPress} onPress={onCenterPress} style={styles.amountRow}>
        <Text style={[styles.amount, { color: relykaColor ?? c.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {bigLabel}
        </Text>
        {/* Pastille « i » collée en haut à droite du montant : le seul indice nécessaire pour
            savoir que le chiffre s'ouvre. Un lien « D'où vient ce chiffre ? » prenait une ligne
            entière pour dire la même chose. */}
        {!!onCenterPress && (
          <View style={[styles.amountInfo, { borderColor: relykaColor ?? c.textSecondary }]}>
            <Text style={[styles.amountInfoText, { color: relykaColor ?? c.textSecondary }]}>i</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Fond ultra léger + trait de base (racine des colonnes) pour donner du relief au graphe. */}
      <View style={styles.chartCard}>
        <View style={styles.barsRow}>
          {columns.map((col, i) => {
            const done = Math.max(0, col.done ?? 0);
            const sure = Math.max(0, col.range?.isRange ? col.range.low : col.amount);
            const top = Math.max(sure, col.range?.high ?? col.amount);
            const hDone = (done / maxVal) * CHART_H;
            const hSure = (Math.max(0, sure) / maxVal) * CHART_H;
            const hUncertain = (Math.max(0, top - sure) / maxVal) * CHART_H;
            return (
              <TouchableOpacity key={col.key} style={styles.barCol} activeOpacity={0.7} onPress={() => onColumnPress?.(i)}>
                <View style={styles.barStack}>
                  {hUncertain > 0.5 && (
                    <Animated.View style={[styles.segUncertain, { height: gh(hUncertain), backgroundColor: col.color + '33', borderColor: col.color + '66' }]} />
                  )}
                  {hSure > 0.5 && <Animated.View style={[styles.seg, { height: gh(hSure), backgroundColor: col.color }]} />}
                  {hDone > 0.5 && <Animated.View style={[styles.seg, { height: gh(hDone), backgroundColor: darken(col.color, 0.35) }]} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.labelsRow}>
        {columns.map((col, i) => {
          // Même règle que le montant principal : l'étiquette porte le montant RECOMMANDÉ, pas une
          // borne. La fourchette reste lisible dans la colonne elle-même (segment clair + légende).
          const label = fmtInt(col.amount);
          return (
            <TouchableOpacity key={col.key} style={styles.labelCol} activeOpacity={0.7} onPress={() => onColumnPress?.(i)}>
              <Text style={[styles.colValue, { color: col.color }]} numberOfLines={1}>{label}</Text>
              <Text style={styles.colLabel} numberOfLines={1}>{col.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Légende : nuances dans le MÊME ordre que les segments (du bas vers le haut de la colonne),
          avec des pastilles qui reproduisent exactement l'aspect de chaque segment. */}
      {(anyDone || anyRange) && (
        <View style={styles.legend}>
          {anyDone && (
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: darken(c.textSecondary, 0.45) }]} />
              <Text style={styles.legendText}>déjà fait</Text>
            </View>
          )}
          {anyRange && (
            <>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: c.textSecondary }]} />
                <Text style={styles.legendText}>minimum sûr</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, styles.legendSwatchDashed, { backgroundColor: c.textSecondary + '2E', borderColor: c.textSecondary + '77' }]} />
                <Text style={styles.legendText}>si tout est à jour</Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  const chartBg = c.mode === 'light' ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)';
  return StyleSheet.create({
    wrap: { flex: 1, alignSelf: 'stretch', gap: 8 },
    amountRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 },
    amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
    amountInfo: {
      width: 15, height: 15, borderRadius: 8, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
      alignSelf: 'flex-start', marginTop: 2, opacity: 0.7,
    },
    amountInfoText: { fontSize: 10, fontWeight: '800', lineHeight: 13 },
    // Fond léger + trait de base sous les colonnes.
    chartCard: {
      height: CHART_H,
      backgroundColor: chartBg,
      borderRadius: 10,
      borderBottomWidth: 1.5,
      borderBottomColor: c.cardBorder,
      paddingHorizontal: 6,
      paddingTop: 4,
      justifyContent: 'flex-end',
    },
    barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: CHART_H - 4, gap: 8 },
    barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
    // Largeur de barre plafonnée : sans ça, avec 1 seule colonne le bloc (76 % de toute la carte)
    // devient un gros pavé peu lisible. Le plafond garde des barres cohérentes de 1 à 4 colonnes.
    barStack: { width: '76%', maxWidth: 64, borderTopLeftRadius: 5, borderTopRightRadius: 5, overflow: 'hidden', justifyContent: 'flex-end' },
    seg: { width: '100%' },
    segUncertain: { width: '100%', borderWidth: 1, borderStyle: 'dashed', borderBottomWidth: 0, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
    labelsRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 8, marginTop: 5 },
    labelCol: { flex: 1, alignItems: 'center', gap: 2 },
    colValue: { fontSize: 11.5, fontWeight: '800' },
    colLabel: { fontSize: 10, color: c.textSecondary, fontWeight: '600', textAlign: 'center' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendSwatch: { width: 12, height: 12, borderRadius: 3 },
    legendSwatchDashed: { borderWidth: 1.2, borderStyle: 'dashed' },
    legendText: { fontSize: 10, color: c.textSecondary, fontWeight: '600' },
  });
}
