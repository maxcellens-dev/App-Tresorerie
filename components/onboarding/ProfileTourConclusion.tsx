/**
 * CONCLUSION DU PARCOURS DE DÉMARRAGE — « voici ton profil financier ».
 *
 * S'affiche UNE SEULE FOIS, juste après la DERNIÈRE étape (la marge de sécurité), jamais avant :
 * pendant l'installation, le profil bouge à chaque saisie — comptes, puis récurrences, puis les deux
 * repères — et l'annoncer en cours de route revenait à interrompre l'utilisateur pour un chiffre pas
 * encore stabilisé. À ce moment précis, en revanche, TOUTES les données qui le déterminent ont été
 * saisies : il conclut « voilà ce que tes données disent de toi », et c'est vrai.
 *
 * Deux cas, et AUCUNE action demandée dans les deux :
 *  • tout est renseigné → on présente le profil obtenu et sa répartition ;
 *  • il manque une donnée → on dit LAQUELLE, sans rien réclamer. Le jour où elle arrive, le
 *    comportement normal reprend : le profil se recalcule et l'utilisateur en est informé par
 *    ProfileChangeModal.
 *
 * MISE EN SCÈNE (deux temps) : le profil apparaissait d'un coup, sans qu'on comprenne d'où il
 * sortait — on aurait dit un écran de plus. Il est donc précédé d'un court dépouillement (~1,6 s)
 * qui NOMME ce qu'on regarde (tes comptes, tes charges, ta rentrée d'argent) : le résultat se lit
 * alors comme la CONCLUSION de ce que l'utilisateur vient de saisir. Puis il se pose (fondu +
 * remontée), l'emblème apparaît en ressort et les barres de répartition se remplissent en cascade.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAuth } from '../../contexts/AuthContext';
import { useGuide } from '../../contexts/GuideContext';
import { useFinancialProfile, useProfileAllocations } from '../../hooks/pilotage/useFinancialProfile';
import { usePilotageData } from '../../hooks/pilotage/usePilotageData';
import { useProfile } from '../../hooks/data/useProfile';
import { PROFILE_INFO, PROFILE_ALLOCATIONS, resolveProfileId } from '../../lib/finance/financialProfileEngine';
import { resolveMonthlyAllocation } from '../../lib/finance/financialPriorities';
import { computeSecurityCushion, securityMonthsLabel } from '../../lib/finance/securityCushion';
import { useProfileReliability } from '../../hooks/pilotage/useProfileReliability';
import type { FinancialProfileId } from '../../types/database';
import { sheetWidth } from '../../lib/ui/appLayout';

/** Durée du dépouillement. Assez long pour être lu, assez court pour ne pas faire attendre. */
const SCAN_MS = 1650;
/** Ce qu'on dit qu'on regarde — ce sont exactement les données saisies pendant le parcours. */
const SCAN_LINES = [
  'On regarde tes comptes et leurs soldes…',
  'Puis ta rentrée d’argent et tes charges…',
  'Ton profil se dessine…',
];

export default function ProfileTourConclusion() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user, isImpersonating } = useAuth();
  const guide = useGuide();
  const { data: fp } = useFinancialProfile(user?.id);
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: userProfile } = useProfile(user?.id);
  /* Sur quoi le palier repose. À la fin du parcours, c'est LA question : « Découverte », d'accord,
     mais pourquoi ? (cf. lib/finance/profileReliability) */
  const reliability = useProfileReliability(user?.id);
  // Même table que le moteur (réglable en administration, migration 207).
  const { data: allocTable } = useProfileAllocations();
  const relColor = reliability?.tone === 'good' ? (COLORS.green ?? COLORS.emerald)
    : reliability?.tone === 'warn' ? COLORS.orange : COLORS.danger;

  // Le parcours est TERMINÉ (dernière bulle passée) et la conclusion n'a pas encore été montrée.
  const shouldShow = guide.tourJustFinished;
  const visible = !isImpersonating && shouldShow && !!fp;

  /* ── Mise en scène ─────────────────────────────────────────────────────────────────────────────
     `phase` : on dépouille, PUIS on annonce. Les valeurs animées sont créées une fois et rejouées
     à chaque ouverture (l'écran n'apparaît qu'une fois dans la vie du compte, mais un remontage
     ne doit pas laisser une animation figée à mi-course). */
  const [phase, setPhase] = useState<'computing' | 'result'>('computing');
  const [scanStep, setScanStep] = useState(0);
  const scan = useRef(new Animated.Value(0)).current;   // jauge du dépouillement (largeur → pas de driver natif)
  const cardIn = useRef(new Animated.Value(0)).current; // arrivée de la carte de résultat
  const emblem = useRef(new Animated.Value(0)).current; // ressort de l'emblème du profil
  const bars = useRef(new Animated.Value(0)).current;   // remplissage des barres, en cascade

  useEffect(() => {
    if (!visible) return;
    setPhase('computing');
    setScanStep(0);
    scan.setValue(0); cardIn.setValue(0); emblem.setValue(0); bars.setValue(0);

    const gauge = Animated.timing(scan, {
      toValue: 1, duration: SCAN_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false,
    });
    gauge.start();

    const timers = SCAN_LINES.map((_, i) =>
      i === 0 ? null : setTimeout(() => setScanStep(i), (SCAN_MS / SCAN_LINES.length) * i),
    );
    const reveal = setTimeout(() => {
      setPhase('result');
      Animated.sequence([
        Animated.parallel([
          Animated.timing(cardIn, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(emblem, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
        ]),
        Animated.timing(bars, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]).start();
    }, SCAN_MS + 140);

    return () => {
      gauge.stop();
      timers.forEach((t) => t && clearTimeout(t));
      clearTimeout(reveal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  // Ramené sur le référentiel de ce bundle : un identifiant plus récent (migration déployée avant
  // la mise à jour du code) faisait disparaître l'écran au lieu de montrer le profil.
  const profileId = resolveProfileId((fp as any).profile_id);
  const info = PROFILE_INFO[profileId];
  if (!info) return null;

  const income = pilotage?.avg_monthly_income ?? 0;
  const savings = pilotage?.current_savings ?? 0;
  const marginSet = (userProfile as any)?.safety_margin_amount != null;
  const variableSet = Number((userProfile as any)?.weekly_variable_budget ?? 0) > 0
    || Number(pilotage?.variable_envelope_initial ?? 0) > 0;

  /* CE QUI MANQUE ENCORE — repris du module de FIABILITÉ, plus d'une liste écrite à la main ici.
     Elle omettait les charges récurrentes, qui sont pourtant la première cause d'un profil resté en
     « Découverte » : l'écran annonçait un palier sans jamais dire pourquoi celui-là. Une seule
     source, les mêmes causes et les mêmes gestes que sur la page « Profil financier ».
     La marge de sécurité reste énoncée à part : elle n'entre pas dans le classement (elle affine le
     Relyka), donc le module de fiabilité n'en parle pas — mais c'est le moment de la rappeler. */
  const missing: string[] = reliability
    ? reliability.gaps.map((g) => g.label.toLowerCase())
    : [];
  if (!marginSet) missing.push('ta marge de sécurité');

  const cushionMonths = computeSecurityCushion({
    availableSavings: savings,
    monthlyEssentialExpenses: pilotage?.monthly_essential_expenses ?? 0,
    // Même garde que le moteur : sans charge saisie, le dénominateur est amputé (cf. securityCushion).
    recurringExpensesKnown: !!pilotage?.has_recurring_expenses,
    avgMonthlyIncome: income,
  }).months;

  /* Les pourcentages ANNONCÉS sont ceux qui seront APPLIQUÉS : la table brute du palier est
     ajustée par la priorité du mois (cf. resolveMonthlyAllocation). Cet écran conclut le
     parcours — présenter une répartition que le tableau de bord contredit dès la seconde
     suivante serait la pire des premières impressions. */
  const alloc = pilotage
    ? resolveMonthlyAllocation(profileId, {
        monthsOfReserve: cushionMonths,
        monthlySurplus: pilotage.projected_surplus ?? 0,
        avgMonthlyIncome: income,
        monthlyEssentialExpenses: pilotage.monthly_essential_expenses ?? 0,
        checkingBalance: pilotage.current_checking_balance ?? 0,
        savingsBalance: savings,
        investedBalance: pilotage.total_invested ?? 0,
        irregularIncome: Boolean((fp as any)?.is_irregular_income),
      }, null, allocTable).alloc
    : (allocTable?.[profileId] ?? PROFILE_ALLOCATIONS[profileId]);
  if (!alloc) return null;

  const ALLOC_ROWS = [
    { label: 'Épargner', pct: alloc.save, color: COLORS.green ?? COLORS.emerald },
    { label: 'Investir', pct: alloc.invest, color: COLORS.violet },
    { label: 'Confort', pct: alloc.enjoy, color: COLORS.orange },
    { label: 'Conserver', pct: alloc.keep, color: COLORS.blue },
  ];

  /* DÉPOUILLEMENT — l'écran d'attente qui relie le parcours à son résultat. Volontairement sobre :
     une jauge, une phrase qui change, rien à faire. */
  if (phase === 'computing') {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, styles.scanSheet]}>
            <Text style={styles.eyebrow}>Parcours terminé</Text>
            <Text style={styles.scanTitle}>On calcule ton profil financier</Text>
            <View style={styles.scanTrack}>
              <Animated.View
                style={[
                  styles.scanFill,
                  { width: scan.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] }) },
                ]}
              />
            </View>
            <Text style={styles.scanLine}>{SCAN_LINES[scanStep]}</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: cardIn,
              transform: [
                { translateY: cardIn.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                { scale: cardIn.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
              ],
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            <Text style={styles.eyebrow}>Voilà ce que tes données disent</Text>
            <Animated.Text
              style={[
                styles.emoji,
                {
                  transform: [
                    { scale: emblem.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                    { rotate: emblem.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }) },
                  ],
                },
              ]}
            >
              {info.emoji}
            </Animated.Text>
            <Text style={styles.title}>Ton profil : {info.name}</Text>
            <Text style={styles.desc}>{info.description}</Text>

            {/* SUR QUOI CE PALIER REPOSE — la question qu'on se pose immédiatement en lisant
                « Découverte » à la fin du parcours. Sans elle, le nom du profil est un verdict sans
                cause : on ne peut ni le comprendre, ni savoir quoi faire pour qu'il change. */}
            {!!reliability && (
              <View style={[styles.relRow, { borderColor: relColor + '55', backgroundColor: relColor + '12' }]}>
                <View style={[styles.relDot, { backgroundColor: relColor }]} />
                <Text style={styles.relText} numberOfLines={2}>{reliability.title}</Text>
              </View>
            )}

            {/* Ce que le profil DÉCIDE : la répartition. C'est son unique rôle, autant le montrer.
                Les barres se remplissent en CASCADE (décalage de 0,1 par ligne sur la même valeur
                animée) : on voit la répartition se constituer, ligne après ligne. */}
            <View style={styles.allocCard}>
              <Text style={styles.allocTitle}>Comment ton Relyka sera réparti</Text>
              {ALLOC_ROWS.map((r, i) => (
                <View key={r.label} style={styles.allocRow}>
                  <Text style={styles.allocLabel}>{r.label}</Text>
                  <View style={styles.allocTrack}>
                    <Animated.View
                      style={[
                        styles.allocFill,
                        {
                          backgroundColor: r.color,
                          width: bars.interpolate({
                            inputRange: [0.1 * i, Math.min(1, 0.1 * i + 0.7)],
                            outputRange: ['0%', `${r.pct}%`],
                            extrapolate: 'clamp',
                          }),
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.allocPct, { color: r.color }]}>{r.pct} %</Text>
                </View>
              ))}
            </View>

            {missing.length > 0 ? (
              /* CONSTAT, pas consigne : aucun bouton, aucune obligation. On explique simplement que
                 le profil s'affinera tout seul quand ces données arriveront. */
              <View style={styles.missingCard}>
                <View style={styles.missingHead}>
                  <Ionicons name="information-circle-outline" size={17} color={COLORS.orange} />
                  <Text style={styles.missingTitle}>Il s’affinera encore</Text>
                </View>
                <Text style={styles.missingText}>
                  Pour l’instant Relyka reste prudent : il lui manque {missing.join(', ')}.
                  {'\n'}Dès que ce sera renseigné, ton profil se met à jour tout seul — on te le dira.
                </Text>
              </View>
            ) : (
              <Text style={styles.okText}>
                Calculé sur tes vraies données{cushionMonths != null ? ` \nton épargne couvre ≈ ${securityMonthsLabel(cushionMonths)} de revenus` : ''}.
                {'\n'}Ton profil peut évoluer selon ta situation.
              </Text>
            )}

          </ScrollView>

          <TouchableOpacity style={styles.cta} onPress={() => guide.done('g2_profile_shown')} activeOpacity={0.85}>
            <Text style={styles.ctaText}>C’est parti</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    sheet: {
      ...sheetWidth, maxHeight: '86%',
      backgroundColor: c.cardSolid, borderRadius: 26,
      borderWidth: 1, borderColor: c.emerald + '44',
      paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16, gap: 12,
    },
    content: { alignItems: 'center', gap: 8 },
    eyebrow: { fontSize: 11.5, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },

    /* Dépouillement : même carte, mais courte et centrée — on n'y fait rien, on regarde. */
    scanSheet: { alignItems: 'center', paddingVertical: 30, gap: 16 },
    scanTitle: { fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.3 },
    scanTrack: { width: '82%', height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden' },
    scanFill: { height: 6, borderRadius: 3, backgroundColor: c.emerald },
    scanLine: { fontSize: 13, color: c.textSecondary, textAlign: 'center', minHeight: 19 },

    emoji: { fontSize: 40, marginTop: 2 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.4 },
    desc: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },

    allocCard: {
      width: '100%', marginTop: 10, gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14,
    },
    allocTitle: { fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 2 },
    allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    allocLabel: { width: 74, fontSize: 12.5, color: c.text },
    allocTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden' },
    allocFill: { height: 6, borderRadius: 3 },
    allocPct: { width: 40, fontSize: 12.5, fontWeight: '800', textAlign: 'right' },

    missingCard: {
      width: '100%', marginTop: 4, gap: 6,
      borderWidth: 1, borderColor: c.orange + '44', backgroundColor: c.orange + '12',
      borderRadius: 16, padding: 13,
    },
    missingHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    missingTitle: { fontSize: 13.5, fontWeight: '800', color: c.orange },
    missingText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18.5 },

    // Fiabilité : une pastille de ton et son libellé, juste sous le nom du palier.
    relRow: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginTop: 2,
    },
    relDot: { width: 8, height: 8, borderRadius: 4 },
    relText: { fontSize: 12, fontWeight: '700', color: c.text },

    okText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18.5, marginTop: 4 },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 15,
    },
    ctaText: { fontSize: 15.5, fontWeight: '800', color: c.bg },
  });
}
