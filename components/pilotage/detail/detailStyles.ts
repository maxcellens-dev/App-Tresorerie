/**
 * Styles des modaux de DÉTAIL du Pilotage (le clic sur un montant du « Suivi du mois »).
 *
 * Déplacés VERBATIM depuis `makeStyles` de `app/(tabs)/pilotage.tsx` : 47 règles qui ne servaient
 * qu'à ce modal et à rien d'autre dans l'écran (vérifié avant le déplacement). Elles sont partagées
 * par les quatre sous-blocs (`SpentDetail`, `PlannedSimpleDetail`, `PlannedDetail`, `RelykaDetail`),
 * d'où un module à part plutôt qu'une copie dans chacun.
 *
 * Cf. docs/PLAN_REFACTOR_TESTS.md, phase C1 (DetailModal).
 */
import { StyleSheet } from 'react-native';
import type { AppColors } from '../../../theme/palette';

export function makeDetailStyles(c: AppColors) {
  return StyleSheet.create({
  // ── Modaux détail (centrés) ──
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailBox: { width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
  // Web bureau : une boîte de 460 px perdue au milieu d'un écran de 1500 flotte et oblige à faire
  // défiler pour deux lignes de liste. On l'élargit et on met le camembert et sa légende côte à côte.
  detailBoxDesktop: { maxWidth: 820, padding: 24, borderRadius: 18 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailTitle: { fontSize: 17, fontWeight: '800', color: c.text, flex: 1 },
  detailTitleDesktop: { fontSize: 20 },
  // ── Bloc « aperçu » d'un modal de détail : camembert + légende + filtres ──
  // Mobile : empilés (inchangé). Bureau : deux colonnes, l'anneau à gauche, tout le reste à droite.
  chartBlockDesktop: { flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 4 },
  chartLegendDesktop: { flex: 1, minWidth: 0 },
  /**
   * Barre des filtres TRANSVERSES (« Récurrentes », « À venir »). Ils ne sont pas des catégories :
   * mélangés aux pastilles de la légende, ils passaient pour une part du camembert de plus. On les
   * sort donc sur leur propre ligne, séparés par un filet, et avec une forme différente
   * (rectangle arrondi vs pastille ronde) pour qu'on lise « filtre » et non « catégorie ».
   */
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.cardBorder,
  },
  filterBarLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase',
    color: c.textSecondary, opacity: 0.7, marginRight: 2,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
    paddingVertical: 6, paddingHorizontal: 10,
  },
  filterChipText: { fontSize: 12, color: c.text, fontWeight: '700' },
  filterChipVal: { fontSize: 12, fontWeight: '800' },
  // ── Décomposition de l'enveloppe variable (modal « Ce qui va encore sortir ») ──
  // Une jauge + trois lignes : d'où vient le chiffre, ce qui a déjà été consommé, ce qui reste.
  envBlock: {
    gap: 5, marginTop: 8, marginBottom: 2,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  envBarTrack: { height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden', marginBottom: 4 },
  envBarFill: { height: '100%', borderRadius: 3 },
  // Version compacte : enveloppe / dépensé / reste sur UNE ligne (au lieu de trois).
  envInline: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  envInlineItem: { flex: 1, gap: 1 },
  envInlineLabel: { fontSize: 10.5, color: c.textSecondary, fontWeight: '600' },
  envInlineVal: { fontSize: 13.5, fontWeight: '800' },
  // Sélecteur de référence (Auto / Estimation / Réel)
  varModeRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  varModeChip: {
    flex: 1, alignItems: 'center', gap: 1, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
  },
  varModeChipOn: { borderColor: c.emerald, backgroundColor: c.emerald + '18' },
  varModeLabel: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary },
  varModeValue: { fontSize: 12, fontWeight: '800', color: c.text },
  varModeLabelOn: { color: c.emerald },
  varModeActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  varModeSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14,
  },
  varModeSaveText: { fontSize: 13, fontWeight: '800', color: c.bg },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
  detailRowLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
  detailRowSub: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  // Invitation à définir la marge, affichée dans le détail du Relyka quand elle vaut 0 €.
  marginNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.blue + '12', borderWidth: 1, borderColor: c.blue + '33',
    borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, marginTop: 6,
  },
  marginNudgeText: { flex: 1, fontSize: 12, color: c.blue, lineHeight: 17.5 },
  detailRowValue: { fontSize: 15, fontWeight: '700' },
  detailEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 20 },
  pieLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pieLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, maxWidth: '100%' },
  pieDot: { width: 9, height: 9, borderRadius: 5 },
  pieLegendText: { fontSize: 12, color: c.text, fontWeight: '600', flexShrink: 1 },
  pieLegendVal: { fontSize: 12, fontWeight: '800' },
  detailNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 4 },
  detailEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12' },
  detailEditBtnText: { fontSize: 13, fontWeight: '700', color: c.emerald },
  suiviDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 6 },
  });
}

export type DetailStyles = ReturnType<typeof makeDetailStyles>;
