/**
 * MON PARCOURS — fusion de l'ancien « Mon parcours » et du « Profil financier » : les deux parlaient
 * de la même chose (où tu en es, et ce que ça change pour ton Relyka).
 *
 * Rien de nouveau n'est calculé, tout vient des mêmes sources que l'écran Profil financier :
 *   - le palier (PROFILE_INFO / resolveProfileId) et sa fiabilité (useProfileReliability) ;
 *   - la répartition APPLIQUÉE (appliedAllocation + table admin) — jamais une copie ;
 *   - le matelas mesuré (computeSecurityCushion) et les traits des racines de l'arbre (une seule
 *     ligne une fois le dernier trait atteint : les étapes franchies n'ont plus à prendre la place) ;
 *   - TOUTES les étapes du profil (P1 → P9), avec la tienne : l'arbre grandit avec elles ;
 *   - marge de sécurité et budget variable, lus et écrits dans `profiles` (source unique).
 * Les réglages s'ouvrent dans des feuilles, la page reste courte.
 */
import { live } from '../../../lib/garden/live';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage, { GardenColumns } from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenCard from '../../../components/garden/GardenCard';
import { MarginSheet, EstimateSheet } from '../../../components/garden/MonthSettingsSheets';
import GardenButton from '../../../components/garden/GardenButton';
import GardenBar from '../../../components/garden/GardenBar';
import { menuHref } from '../../../components/garden/GardenTabBar';
import { GardenRowGroup } from '../../../components/garden/GardenList';
import RecoModeModal from '../../../components/pilotage/RecoModeModal';
import ProfileReliabilitySheet from '../../../components/ui/ProfileReliabilitySheet';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useGardenModel } from '../../../hooks/garden/useGardenModel';
import { useFinancialProfile, useProfileAllocations, useProfileMatrixConfig } from '../../../hooks/pilotage/useFinancialProfile';
import GardenSheet from '../../../components/garden/GardenSheet';
import { useProfileReliability } from '../../../hooks/pilotage/useProfileReliability';
import { useProfile } from '../../../hooks/data/useProfile';
import { PROFILE_INFO, resolveProfileId, thresholdsFromMatrix, type ProfileThresholds } from '../../../lib/finance/financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel, securityBaseLabel } from '../../../lib/finance/securityCushion';
import { resolveRecoMode, appliedAllocation } from '../../../lib/finance/recoMode';
import { formatEuros } from '../../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../../lib/garden/theme';
import { GARDEN_ICONS } from '../../../lib/garden/icons';
import { TREE_PARTS, WORDS, rootsGoal } from '../../../lib/garden/lexicon';
import { CHOICE_LOOKS } from '../../../lib/garden/choiceLooks';
import { CLASSED_PROFILES } from '../../../lib/garden/gardenRules';
import { treeSize } from '../../../lib/garden/scene3dLayout';
import { pointer } from '../../../lib/ui/webLayout';
import { GARDEN_FONTS as GF } from '../../../lib/garden/fontFamilies';

const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

/* Chaque part du Relyka : le geste de Pépin (mêmes mots et couleurs que le Jardin, lib/garden/choiceLooks). */
const ALLOC = live(() => (['save', 'invest', 'enjoy', 'keep'] as const).map((key) => {
  const l = CHOICE_LOOKS[key];
  return { key, label: l.meaning.charAt(0).toUpperCase() + l.meaning.slice(1), part: l.verb, fill: l.fill, track: l.bg, fg: l.fg };
}));

type Editing = null | 'margin' | 'weekly';

export default function ParcoursScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { core, tree, rules } = useGardenModel();
  const p = core.pilotageData;
  const { data: fp } = useFinancialProfile(core.userId);
  const { data: allocTable } = useProfileAllocations();
  const { data: userProfile } = useProfile(core.userId);
  const reliability = useProfileReliability(core.userId);
  const [showRecoMode, setShowRecoMode] = useState(false);
  const [showReliability, setShowReliability] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  // Racines et étapes REPLIÉES : la page s'ouvre sur l'essentiel, le détail se déplie au besoin.
  const [rootsOpen, setRootsOpen] = useState(false);
  const [ladderOpen, setLadderOpen] = useState(false);
  const [stepShown, setStepShown] = useState<(typeof CLASSED_PROFILES)[number] | null>(null);
  const { data: matrix } = useProfileMatrixConfig();
  const thresholds = thresholdsFromMatrix(matrix as any[]);
  const go = (r: string) => router.push(r as any);

  const pid = fp?.profile_id ? resolveProfileId(fp.profile_id) : null;
  const info = pid ? PROFILE_INFO[pid] : null;
  const recoMode = resolveRecoMode(userProfile);
  const alloc = pid ? appliedAllocation(pid, recoMode.manualAllocation, allocTable) : null;
  const margin = Number((userProfile as any)?.safety_margin_amount ?? 0);
  const weekly = Number((userProfile as any)?.weekly_variable_budget ?? 0);
  const cushion = computeSecurityCushion({
    availableSavings: p?.current_savings ?? 0,
    monthlyEssentialExpenses: p?.monthly_essential_expenses ?? 0,
    recurringExpensesKnown: !!p?.has_recurring_expenses,
    avgMonthlyIncome: p?.avg_monthly_income ?? 0,
  });
  const m = tree.roots.months;
  const [mk1, mk2, mk3, mk4] = tree.roots.markMonths;
  const marks: [number, boolean][] = [[mk1, tree.roots.marks.one], [mk2, tree.roots.marks.three], [mk3, tree.roots.marks.six], [mk4, tree.roots.marks.twelve]];
  const nextMark = marks.find(([, ok]) => !ok)?.[0];
  const relColor = reliability ? (reliability.tone === 'good' ? G.branchesText : reliability.tone === 'warn' ? G.noticeText : G.fruitsText) : G.muted;

  /* ── Ton étape : qui tu es aujourd'hui, et d'où ça vient ── */
  const stepCard = info ? (
    <GardenCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: G.branchesBg, alignItems: 'center', justifyContent: 'center' }}>
          <GardenText variant="title">{info.emoji}</GardenText>
        </View>
        <View style={{ flex: 1 }}>
          <GardenText variant="label">{WORDS.myStep}</GardenText>
          <GardenText variant="heading">{info.name}</GardenText>
        </View>
      </View>
      <GardenText variant="body" color={G.inkSoft}>{info.description}</GardenText>
      {reliability ? (
        <Pressable onPress={() => setShowReliability(true)} accessibilityRole="button" accessibilityLabel={`${reliability.title}, voir le détail`}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: GARDEN_RADII.pill, backgroundColor: G.field, borderWidth: 1, borderColor: G.line }, pointer]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: relColor }} />
          <GardenText variant="smallStrong" color={G.ink}>{reliability.title}</GardenText>
          <Ionicons name="information-circle-outline" size={16} color={G.muted} />
        </Pressable>
      ) : null}
    </GardenCard>
  ) : (
    <GardenCard>
      <GardenText variant="heading">Ton étape se calcule toute seule</GardenText>
      <GardenText variant="body" color={G.inkSoft}>Renseigne tes comptes et tes rentrées d’argent récurrentes, et ton étape apparaît ici.</GardenText>
      <GardenButton label="Voir mes comptes" variant="secondary" onPress={() => go(menuHref('argent'))} />
    </GardenCard>
  );

  /* ── Ce que ton étape change : la répartition de ton Relyka ── */
  const allocCard = alloc ? (
    <GardenCard>
      <GardenText variant="label">{recoMode.mode === 'manual' ? 'Ta répartition (réglée à la main)' : 'Comment Pépin répartit ton Relyka'}</GardenText>
      {ALLOC.map((a) => (
        <View key={a.key} style={{ gap: 4 }}>
          {/* Libellé qui passe à la ligne, pourcentage qui ne rétrécit jamais : « Reste sur ton compte
              courant » poussait le % hors de la carte. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: GARDEN_SPACE.md }}>
            <GardenText variant="bodyStrong" color={a.fg} style={{ flex: 1, minWidth: 0 }}>{a.label} <GardenText variant="small" color={G.muted}>· {a.part}</GardenText></GardenText>
            <GardenText variant="bodyStrong" color={a.fg} tabular style={{ flexShrink: 0 }}>{alloc[a.key]} %</GardenText>
          </View>
          <GardenBar value={alloc[a.key] / 100} fill={a.fill} track={a.track} accessibilityLabel={`${a.label} : ${alloc[a.key]} %`} />
        </View>
      ))}
      <GardenText variant="small" color={G.muted}>Ces pourcentages répartissent ton Relyka, jamais les montants : eux viennent de tes comptes.</GardenText>
      <GardenButton label="Régler la répartition" variant="secondary" onPress={() => setShowRecoMode(true)} />
    </GardenCard>
  ) : null;

  /* ── Tes racines : l'épargne et ses traits — une seule ligne quand tout est franchi ── */
  const rootsCard = tree.roots.golden ? (
    <GardenCard tint={G.rootsBg} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: G.roots }}>
        <Ionicons name="checkmark" size={17} color={G.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <GardenText variant="bodyStrong" color={G.rootsText}>{TREE_PARTS.roots.name} · {months(m)} mois de dépenses de côté</GardenText>
        <GardenText variant="small" color={G.inkSoft}>{tree.roots.beyondLast ? `Couche dorée atteinte, et ${months(tree.roots.extraMonths)} mois au-delà des ${months(mk4)} : ils pourraient faire pousser tes fruits.` : `Couche dorée atteinte : ${months(mk4)} mois d'épargne, c'est très solide.`}</GardenText>
      </View>
    </GardenCard>
  ) : (
    <GardenCard tint={G.rootsBg}>
      <FoldHeader open={rootsOpen} onToggle={() => setRootsOpen((o) => !o)} color={G.rootsText}
        title={`${TREE_PARTS.roots.name} · ${months(m)} mois`}
        summary={nextMark ? `Prochain trait : ${months(nextMark)} mois d'épargne disponible` : undefined} />
      {rootsOpen && marks.map(([n, ok]) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? G.roots : 'transparent', borderWidth: 2, borderColor: ok ? G.roots : '#E5CF9F' }}>
            {ok ? <Ionicons name="checkmark" size={15} color={G.ink} /> : null}
          </View>
          <GardenText variant={ok ? 'body' : 'bodyStrong'} color={ok ? G.inkSoft : G.ink} style={{ flex: 1 }}>{ok ? `${n} mois d'épargne disponible` : rootsGoal(n)}</GardenText>
        </View>
      ))}
    </GardenCard>
  );

  /* ── Toutes les étapes : où tu te situes, et comment ton arbre grandit avec elles ── */
  const pidIdx = pid ? CLASSED_PROFILES.indexOf(pid as any) : -1;
  const ladderCard = (
    <GardenCard>
      <FoldHeader open={ladderOpen} onToggle={() => setLadderOpen((o) => !o)} title="Les étapes"
        summary={pidIdx >= 0 ? `Tu es à l'étape ${pidIdx + 1} sur ${CLASSED_PROFILES.length} : ${PROFILE_INFO[CLASSED_PROFILES[pidIdx]].name}` : `${CLASSED_PROFILES.length} étapes, de la plus fragile au patrimoine d'exception`} />
      {ladderOpen ? <>
      <GardenText variant="small" color={G.inkSoft}>Neuf étapes, de la plus fragile au patrimoine d'exception. Ton arbre grandit à chacune.</GardenText>
      <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>
        {CLASSED_PROFILES.map((p, i) => {
          const pi = PROFILE_INFO[p], here = i === pidIdx, passed = pidIdx > i;
          return (
            <Pressable key={p} onPress={() => setStepShown(p)} accessibilityRole="button" accessibilityLabel={`${pi.name}, ${pi.tier}${here ? ', ton étape' : passed ? ', franchie' : ''}. Voir le détail`}
              style={({ hovered }: any) => [pointer, { flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: G.line, backgroundColor: here ? G.branchesBg : hovered ? G.field : G.card, opacity: here || passed ? 1 : 0.62 }]}>
              <GardenText variant="heading" style={{ width: 30, textAlign: 'center' }}>{pi.emoji}</GardenText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <GardenText variant="bodyStrong" color={here ? G.branchesText : G.ink} numberOfLines={1}>{pi.name}</GardenText>
                <GardenText variant="small" color={G.muted} numberOfLines={1}>{pi.tier} · arbre taille {treeSize(rules.growthByProfile[p])}/7</GardenText>
              </View>
              {here ? <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: GARDEN_RADII.pill, backgroundColor: G.primary }}><GardenText variant="smallStrong" color={G.onPrimary} style={{ fontFamily: GF.body, fontSize: 11 }}>Tu es ici</GardenText></View>
                : passed ? <Ionicons name="checkmark-circle" size={18} color={G.branches} /> : null}
              <Ionicons name="chevron-forward" size={16} color={G.muted} />
            </Pressable>
          );
        })}
      </View>
      </> : null}
      {pid === 'P0' || !pid ? <GardenText variant="small" color={G.muted}>Ton étape apparaîtra dès que tes comptes et tes rentrées d'argent seront renseignés.</GardenText> : null}
    </GardenCard>
  );

  /* ── Tes chiffres : ce que l'app mesure, puis ce que toi seul peux dire ── */
  const figures = (
    <>
      <GardenRowGroup title="Ce que l'app mesure" rows={[
        { key: 'cushion', label: 'Matelas de sécurité', sub: cushion.months != null ? securityBaseLabel(cushion.base) : 'ajoute un compte d’épargne pour le calculer', value: cushion.months != null ? securityMonthsLabel(cushion.months) : '—', icon: 'shield-checkmark-outline', iconColor: G.rootsText, iconBg: G.rootsBg },
        { key: 'income', label: 'Revenu de référence', sub: (p?.avg_monthly_income ?? 0) > 0 ? 'moyenne de tes recettes sur 6 mois' : 'saisis tes rentrées d’argent pour l’affiner', value: (p?.avg_monthly_income ?? 0) > 0 ? eur(p!.avg_monthly_income) : '—', icon: 'cash-outline', iconColor: G.branchesText, iconBg: G.branchesBg },
        { key: 'variable', label: 'Dépenses variables', sub: p?.variable_envelope_source === 'history' ? `moyenne réelle sur ${p.variable_envelope_months_used} mois` : 'ton estimation, en attendant 2 mois d’historique', value: (p?.variable_envelope_initial ?? 0) > 0 ? `${eur(p!.variable_envelope_initial)} / mois` : '—', icon: 'cart-outline', iconColor: G.flowersText, iconBg: G.flowersBg },
      ]} />
      <GardenRowGroup title="Ce que tu nous dis" rows={[
        { key: 'margin', label: WORDS.minimumToKeep, sub: "l'eau que tu gardes dans ton arrosoir", value: margin > 0 ? eur(margin) : 'aucune', icon: GARDEN_ICONS.water.icon, iconColor: GARDEN_ICONS.water.fg, iconBg: GARDEN_ICONS.water.bg, onPress: () => setEditing('margin') },
        { key: 'weekly', label: 'Dépenses du quotidien (estimation)', sub: 'sert tant que tu n’as pas 2 mois d’historique', value: weekly > 0 ? `${eur(weekly)} / sem.` : 'estimé pour toi', icon: 'create-outline', iconColor: G.picoText, iconBg: G.pico, onPress: () => setEditing('weekly') },
      ]} />
    </>
  );


  return (
    <GardenPage secondary header={<ScreenHeader title={WORDS.myJourney} onBack={goBack} />}>
      <GardenColumns ratio={0.5}
        left={<>{stepCard}{rootsCard}{ladderCard}</>}
        right={<>{allocCard}{figures}</>}
      />

      <MarginSheet visible={editing === 'margin'} onClose={() => setEditing(null)} userId={core.userId} />
      <EstimateSheet visible={editing === 'weekly'} onClose={() => setEditing(null)} userId={core.userId} />

      {stepShown ? (() => {
        const sp = PROFILE_INFO[stepShown];
        const sAlloc = appliedAllocation(stepShown, null, allocTable);
        const idx = CLASSED_PROFILES.indexOf(stepShown);
        return (
          <GardenSheet visible onClose={() => setStepShown(null)} title={`${sp.emoji} ${sp.name}`} subtitle={`Étape ${idx + 1} sur ${CLASSED_PROFILES.length} · ${sp.tier}`}>
            <GardenCard tint={G.branchesBg}>
              <GardenText variant="label" color={G.branchesText}>{stepShown === pid ? 'Tu es ici' : idx < pidIdx ? 'Étape franchie' : 'Pour y arriver'}</GardenText>
              <GardenText variant="bodyStrong">{stepCondition(stepShown, thresholds)}</GardenText>
            </GardenCard>
            <GardenText variant="body" color={G.inkSoft}>{sp.description}</GardenText>
            <GardenText variant="small" color={G.muted}>Ton arbre à cette étape : taille {treeSize(rules.growthByProfile[stepShown])} sur 7.</GardenText>
            <GardenText variant="label">Comment Pépin répartit ton Relyka à cette étape</GardenText>
            {ALLOC.map((a) => (
              <View key={a.key} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: GARDEN_SPACE.md }}>
                  <GardenText variant="bodyStrong" color={a.fg} style={{ flex: 1, minWidth: 0 }}>{a.label}</GardenText>
                  <GardenText variant="bodyStrong" color={a.fg} tabular style={{ flexShrink: 0 }}>{sAlloc[a.key]} %</GardenText>
                </View>
                <GardenBar value={sAlloc[a.key] / 100} fill={a.fill} track={a.track} accessibilityLabel={`${a.label} : ${sAlloc[a.key]} %`} />
              </View>
            ))}
          </GardenSheet>
        );
      })() : null}

      <RecoModeModal visible={showRecoMode} onClose={() => setShowRecoMode(false)} userId={core.userId} />
      {showReliability && reliability ? (
        <ProfileReliabilitySheet reliability={reliability} onClose={() => setShowReliability(false)} onNavigate={(route) => go(route)} />
      ) : null}
    </GardenPage>
  );
}

/** En-tête d'une carte repliable : titre, résumé d'une ligne, chevron. Toute la ligne se touche. */
function FoldHeader({ open, onToggle, title, summary, color }: { open: boolean; onToggle: () => void; title: string; summary?: string; color?: string }) {
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}, ${open ? 'replier' : 'déplier'}`}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 44 }, pointer]}>
      <View style={{ flex: 1, gap: 2 }}>
        <GardenText variant="label" color={color}>{title}</GardenText>
        {summary && !open ? <GardenText variant="small" color={G.inkSoft}>{summary}</GardenText> : null}
      </View>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={color ?? G.muted} />
    </Pressable>
  );
}

const fmtK = (n: number) => eur(n);

/** Ce qu'il faut pour être à une étape, dit en une phrase — avec les seuils de la base (admin). */
function stepCondition(p: (typeof CLASSED_PROFILES)[number], T: ProfileThresholds): string {
  const m = (n: number) => months(n);
  switch (p) {
    case 'P1': return 'Ce qui sort chaque mois dépasse ce qui rentre.';
    case 'P2': return `Le mois se boucle, mais l'épargne couvre moins de ${m(T.monthsUp.P3)} mois de dépenses.`;
    case 'P3': return `Une épargne d'au moins ${m(T.monthsUp.P3)} mois de dépenses.`;
    case 'P4': return `Une épargne d'au moins ${m(T.monthsUp.P4)} mois de dépenses.`;
    case 'P5': return `Une épargne d'au moins ${m(T.monthsUp.P5)} mois de dépenses.`;
    case 'P6': return `Au moins ${m(T.monthsUp.P6)} mois d'épargne, et au moins ${fmtK(T.investedMinUp)} placés.`;
    default: return `Un patrimoine d'au moins ${fmtK(T.wealthUp[p])}, ${m(T.wealthMinMonths[p])} mois d'épargne et au moins ${Math.round(T.wealthInvestedShareUp * 100)} % placés.`;
  }
}
