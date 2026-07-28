/**
 * DiscoveryIntro — la découverte du tableau de bord, à la PREMIÈRE arrivée.
 *
 * Trois panneaux courts, chacun tenant DANS l'écran sans défilement (contrainte forte : un panneau
 * qu'il faut faire défiler pour voir le bouton se lit mal et se ferme au hasard). On lit, on passe,
 * on ne revient plus — sauf relance depuis l'assistance.
 *
 *  1. LA PAGE — à quoi sert cet écran, puis les 4 recommandations, actives avec leur montant, inactives
 *     avec leur VRAIE raison lue dans le moteur. Aucune raison inventée, aucun « débloqué dans
 *     X jours » : rien n'est verrouillé par le temps.
 *  2. LE BOUTON + — les quatre saisies, dont la mise à jour de solde (et l'appui long).
 *  3. DEUX FAÇONS DE T'EN SERVIR — deux conseils d'usage, avec leurs avantages et leurs limites.
 *     Ce n'est pas un choix à faire : on navigue de l'un à l'autre librement.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { setGuideHighlight } from '../lib/guideHighlight';
import { sheetWidth } from '../lib/appLayout';
import { CURRENCY_SYMBOL } from '../lib/currency';
import InfoDot from './InfoDot';
import {
  deriveRecoAllocations, RECO_TYPE_LABELS,
  type SmartRecommendation, type RecoType,
} from '../lib/recommendationEngine';
import type { PilotageData } from '../hooks/usePilotageData';
import type { FinancialProfileId } from '../types/database';
import type { GlossaryTerm } from '../lib/glossary';

const ORDER: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];

const TERM: Record<RecoType, GlossaryTerm> = {
  save: 'epargner', invest: 'investir', enjoy: 'confort', keep: 'conserver',
};

const ICON: Record<RecoType, string> = {
  save: 'shield-outline', invest: 'trending-up-outline',
  enjoy: 'sparkles-outline', keep: 'hourglass-outline',
};

interface Props {
  data: PilotageData;
  recommendations: SmartRecommendation[];
  financialProfileId?: FinancialProfileId;
  /** Le garde-fou de sécurité est-il actif (tout le Relyka bascule en « Conserver ») ? */
  guardActive?: boolean;
  onClose: () => void;
  onOpenAi?: () => void;
}

export default function DiscoveryIntro({
  data, recommendations, financialProfileId, guardActive, onClose, onOpenAi,
}: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [panel, setPanel] = useState(0);
  const LAST = 2;

  // Panneau « Le bouton + » : on DÉSIGNE le vrai bouton à l'écran (anneau pulsé tracé dans sa
  // propre boîte, cf. lib/guideHighlight) et on remonte la feuille pour ne pas le masquer.
  // Sans ça, on décrivait un bouton que l'utilisateur ne voyait pas — donc on parlait dans le vide.
  const pointing = panel === 1;
  useEffect(() => {
    setGuideHighlight(pointing ? 'quickAdd' : null);
    return () => setGuideHighlight(null);
  }, [pointing]);

  const colorOf: Record<RecoType, string> = {
    save: COLORS.green ?? COLORS.emerald,
    invest: COLORS.violet,
    enjoy: COLORS.orange,
    keep: COLORS.blue,
  };

  /** Parts théoriques du profil — la MÊME fonction que le moteur de recommandations. */
  const alloc = useMemo(() => {
    try {
      return deriveRecoAllocations(data, { financialProfileId }).alloc;
    } catch {
      return { save: 0, invest: 0, enjoy: 0, keep: 0 } as Record<RecoType, number>;
    }
  }, [data, financialProfileId]);

  const byType = useMemo(() => {
    const m: Partial<Record<RecoType, SmartRecommendation>> = {};
    recommendations.forEach((r) => { m[r.type] = r; });
    return m;
  }, [recommendations]);

  /**
   * Raison RÉELLE de l'absence, en UNE ligne. Jamais inventée.
   *
   * On explique le PRINCIPE, jamais le profil auquel l'utilisateur est rattaché : nommer un palier
   * (« sur ton profil Confortable ») transforme une mécanique en étiquette, et invite à se comparer
   * plutôt qu'à comprendre. La règle vaut pour tout le monde ; seul son résultat diffère.
   */
  function reasonFor(type: RecoType): string {
    if (guardActive) return 'En pause : par sécurité, tout part en « Conserver » ce mois-ci.';
    if ((alloc[type] ?? 0) < 5) {
      return type === 'invest'
        ? 'Elle s’ouvre quand ton matelas de sécurité est assez solide. Avant, on le consolide.'
        : 'Rien n’y est affecté ce mois-ci — ta situation ne l’appelle pas.';
    }
    return 'Déjà couverte ce mois-ci, ou trop petite pour valoir un geste.';
  }

  const dots = (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, panel === i && { backgroundColor: COLORS.emerald, width: 18 }]} />
      ))}
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* Quand on désigne le bouton +, le voile s'éclaircit et la feuille remonte : le bouton
          réel, avec son anneau, doit rester visible en bas à droite. */}
      <Pressable
        style={[styles.overlay, pointing && styles.overlayPointing]}
        onPress={onClose}
      >
        <Pressable style={styles.sheet} onPress={() => {}}>

          <View style={styles.header}>
            {dots}
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 4 }} accessibilityLabel="Fermer">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ─────────── 1. LA PAGE + LES 4 RECOMMANDATIONS ─────────── */}
          {panel === 0 && (
            <View style={styles.body}>
              <Text style={styles.title}>Ton tableau de bord</Text>
              <Text style={styles.lede}>
                En haut, <Text style={styles.b}>ton Relyka</Text> : ce qu’il te reste à décider ce
                mois-ci. En dessous, le <Text style={styles.b}>suivi du mois</Text> : où va ton argent.
                <InfoDot term="relyka" size={13} />
              </Text>

              <Text style={styles.section}>Ton Relyka se répartit en 4 recommandations</Text>
              {ORDER.map((type) => {
                const reco = byType[type];
                const active = !!reco && reco.amount > 0;
                const color = colorOf[type];
                return (
                  <View
                    key={type}
                    style={[
                      styles.row,
                      active ? { backgroundColor: color + '14', borderColor: color + '3D' } : null,
                    ]}
                  >
                    <Ionicons
                      name={ICON[type] as any}
                      size={15}
                      color={active ? color : COLORS.textSecondary}
                      style={{ marginTop: 1 }}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowTitleLine}>
                        <Text style={[styles.rowTitle, { color: active ? COLORS.text : COLORS.textSecondary }]}>
                          {RECO_TYPE_LABELS[type]}
                        </Text>
                        <InfoDot term={TERM[type]} size={12} color={active ? color : COLORS.textSecondary} />
                        {active && (
                          <Text style={[styles.rowAmount, { color }]}>
                            {Math.round(reco!.amount).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
                          </Text>
                        )}
                      </View>
                      {!active && <Text style={styles.rowReason} numberOfLines={2}>{reasonFor(type)}</Text>}
                    </View>
                  </View>
                );
              })}
              <Text style={styles.foot}>
                Ça évolue à chaque saisie et chaque mois, selon ta situation réelle.
              </Text>
            </View>
          )}

          {/* ─────────── 2. LE BOUTON + ─────────── */}
          {panel === 1 && (
            <View style={styles.body}>
              <Text style={styles.title}>Le bouton +</Text>
              <Text style={styles.lede}>
                Tout part d’ici, sur n’importe quel écran.
              </Text>

              {[
                { icon: 'arrow-up', color: COLORS.green ?? COLORS.emerald, label: 'Une rentrée d’argent' },
                { icon: 'arrow-down', color: COLORS.danger, label: 'Une dépense' },
                { icon: 'swap-horizontal', color: COLORS.blue, label: 'Un virement entre tes comptes' },
              ].map((a) => (
                <View key={a.label} style={styles.row}>
                  <View style={[styles.pill, { backgroundColor: a.color + '1F' }]}>
                    <Ionicons name={a.icon as any} size={14} color={a.color} />
                  </View>
                  <Text style={styles.rowTitle}>{a.label}</Text>
                </View>
              ))}

              <View style={[styles.row, { backgroundColor: COLORS.emerald + '14', borderColor: COLORS.emerald + '3D' }]}>
                <View style={[styles.pill, { backgroundColor: COLORS.emerald + '2E' }]}>
                  <Ionicons name="refresh" size={14} color={COLORS.emerald} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: COLORS.emerald }]}>Mettre à jour ton solde</Text>
                  <Text style={styles.rowReason}>
                    Le plus rapide, et le seul qui remet tous tes chiffres d’aplomb.
                    <InfoDot term="maj_solde" size={12} color={COLORS.emerald} />
                  </Text>
                </View>
              </View>

              {/* Flèche vers le bouton réel, entouré et pulsé en bas à droite de l'écran. */}
              <View style={styles.pointer}>
                <Ionicons name="arrow-down" size={16} color={COLORS.emerald} />
                <Text style={styles.pointerText}>
                  Le voici, entouré en bas à droite. Un <Text style={styles.b}>appui long</Text> dessus
                  ouvre directement la mise à jour du solde.
                </Text>
              </View>
            </View>
          )}

          {/* ─────────── 3. DEUX FAÇONS DE T'EN SERVIR ─────────── */}
          {panel === 2 && (
            <View style={styles.body}>
              <Text style={styles.title}>Deux façons de t’en servir</Text>
              <Text style={styles.lede}>
                Deux conseils d’usage, selon ton envie. Rien à choisir : tu passes de l’un à l’autre
                quand tu veux.
              </Text>

              <View style={[styles.usage, { borderColor: COLORS.emerald + '44' }]}>
                <Text style={[styles.usageTitle, { color: COLORS.emerald }]}>Au plus simple</Text>
                <Text style={styles.usageLead}>Tu mets ton solde à jour une fois par semaine.</Text>
                <Text style={styles.plus}>+  Presque aucune saisie, Relyka et recommandations justes</Text>
                <Text style={styles.minus}>−  Pas de détail par catégorie</Text>
              </View>

              <View style={[styles.usage, { borderColor: COLORS.blue + '44' }]}>
                <Text style={[styles.usageTitle, { color: COLORS.blue }]}>Au fil de l’eau</Text>
                <Text style={styles.usageLead}>Tu saisis chaque dépense et chaque rentrée.</Text>
                <Text style={styles.plus}>+  Catégories, budget en temps réel, reporting fidèle</Text>
                <Text style={styles.plus}>+  Les Conseils IA analysent vraiment tes habitudes</Text>
                <Text style={styles.minus}>−  Demande un peu de régularité</Text>
                {!!onOpenAi && (
                  <TouchableOpacity
                    style={styles.aiBtn}
                    onPress={() => { onClose(); onOpenAi(); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="sparkles" size={13} color={COLORS.violet} />
                    <Text style={styles.aiBtnText}>Voir les Conseils IA</Text>
                    <Ionicons name="arrow-forward" size={13} color={COLORS.violet} />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.foot}>
                Dans les deux cas : garde tes revenus et charges récurrents à jour.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.cta}
            onPress={() => (panel < LAST ? setPanel(panel + 1) : onClose())}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>{panel < LAST ? 'Suivant' : 'J’ai compris'}</Text>
            <Ionicons name={panel < LAST ? 'arrow-forward' : 'checkmark'} size={16} color={COLORS.bg} />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    // Mode « je désigne le bouton + » : voile plus clair et feuille remontée, pour que le bouton
    // réel (en bas à droite, avec son anneau) reste parfaitement lisible derrière.
    overlayPointing: { backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-start', paddingTop: 70 },
    sheet: {
      ...sheetWidth, maxWidth: 400,
      backgroundColor: c.cardSolid, borderRadius: 24,
      borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.cardBorder },

    body: { gap: 8 },
    title: { fontSize: 20, fontWeight: '800', color: c.text, letterSpacing: -0.4 },
    lede: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    b: { fontWeight: '800', color: c.text },
    section: {
      fontSize: 10.5, fontWeight: '800', color: c.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4,
    },

    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 13,
      paddingHorizontal: 11, paddingVertical: 9,
    },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    rowTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    rowAmount: { marginLeft: 'auto', fontSize: 14, fontWeight: '800' },
    rowReason: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 1 },
    pill: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

    usage: { borderWidth: 1, borderRadius: 14, padding: 11, gap: 3 },
    usageTitle: { fontSize: 14, fontWeight: '800' },
    usageLead: { fontSize: 12.5, color: c.text, lineHeight: 18, marginBottom: 3 },
    plus: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    minus: { fontSize: 12, color: c.textSecondary, lineHeight: 17, opacity: 0.8 },
    aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingTop: 6 },
    aiBtnText: { fontSize: 12, fontWeight: '700', color: c.violet },

    foot: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, fontStyle: 'italic', marginTop: 2 },
    pointer: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2,
      backgroundColor: c.emerald + '14', borderWidth: 1, borderColor: c.emerald + '3D',
      borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9,
    },
    pointerText: { flex: 1, fontSize: 12, color: c.emerald, lineHeight: 17 },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 13,
    },
    ctaText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
