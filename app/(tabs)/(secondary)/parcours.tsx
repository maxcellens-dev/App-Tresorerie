/**
 * MON PARCOURS — fusion de l'ancien « Mon parcours » et du « Profil financier » : les deux parlaient
 * de la même chose (où tu en es, et ce que ça change pour ton Relyka).
 *
 * Rien de nouveau n'est calculé, tout vient des mêmes sources que l'écran Profil financier :
 *   - le palier (PROFILE_INFO / resolveProfileId) et sa fiabilité (useProfileReliability) ;
 *   - la répartition APPLIQUÉE (appliedAllocation + table admin) — jamais une copie ;
 *   - le matelas mesuré (computeSecurityCushion) et les traits des racines de l'arbre ;
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
import { useFinancialProfile, useProfileAllocations } from '../../../hooks/pilotage/useFinancialProfile';
import { useProfileReliability } from '../../../hooks/pilotage/useProfileReliability';
import { useProfile } from '../../../hooks/data/useProfile';
import { PROFILE_INFO, resolveProfileId } from '../../../lib/finance/financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel, securityBaseLabel } from '../../../lib/finance/securityCushion';
import { resolveRecoMode, appliedAllocation } from '../../../lib/finance/recoMode';
import { formatEuros } from '../../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../../lib/garden/theme';
import { GARDEN_ICONS } from '../../../lib/garden/icons';
import { TREE_PARTS, WORDS, rootsGoal } from '../../../lib/garden/lexicon';
import { pointer } from '../../../lib/ui/webLayout';

const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

/* Chaque part du Relyka garde la couleur de la partie de l'arbre qu'elle fait pousser. */
const ALLOC = live(() => ([
  { key: 'save' as const, label: 'Épargner', part: TREE_PARTS.roots.name, fill: G.roots, track: G.rootsBg, fg: G.rootsText },
  { key: 'invest' as const, label: 'Investir', part: TREE_PARTS.branches.name, fill: G.branches, track: G.branchesBg, fg: G.branchesText },
  { key: 'enjoy' as const, label: 'Confort', part: TREE_PARTS.flowers.name, fill: G.flowers, track: G.flowersBg, fg: G.flowersText },
  { key: 'keep' as const, label: 'Conserver', part: TREE_PARTS.can.name, fill: G.water, track: G.waterBg, fg: G.waterText },
]));

type Editing = null | 'margin' | 'weekly';

export default function ParcoursScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { core, tree } = useGardenModel();
  const p = core.pilotageData;
  const { data: fp } = useFinancialProfile(core.userId);
  const { data: allocTable } = useProfileAllocations();
  const { data: userProfile } = useProfile(core.userId);
  const reliability = useProfileReliability(core.userId);
  const [showRecoMode, setShowRecoMode] = useState(false);
  const [showReliability, setShowReliability] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
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
  const marks: [number, boolean][] = [[1, tree.roots.marks.one], [3, tree.roots.marks.three], [6, tree.roots.marks.six]];
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
      <GardenText variant="small" color={G.muted}>Ton étape n'est pas figée : elle se recalcule dès qu'un solde ou un virement change.</GardenText>
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <GardenText variant="bodyStrong" color={a.fg}>{a.label} <GardenText variant="small" color={G.muted}>· {a.part}</GardenText></GardenText>
            <GardenText variant="bodyStrong" color={a.fg} tabular>{alloc[a.key]} %</GardenText>
          </View>
          <GardenBar value={alloc[a.key] / 100} fill={a.fill} track={a.track} accessibilityLabel={`${a.label} : ${alloc[a.key]} %`} />
        </View>
      ))}
      <GardenText variant="small" color={G.muted}>Ces pourcentages répartissent ton Relyka, jamais les montants : eux viennent de tes comptes.</GardenText>
      <GardenButton label="Régler la répartition" variant="secondary" onPress={() => setShowRecoMode(true)} />
    </GardenCard>
  ) : null;

  /* ── Tes racines : l'épargne de secours et ses traits ── */
  const rootsCard = (
    <GardenCard tint={G.rootsBg}>
      <GardenText variant="label" color={G.rootsText}>{TREE_PARTS.roots.name} · {months(m)} mois</GardenText>
      {marks.map(([n, ok]) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? G.roots : 'transparent', borderWidth: 2, borderColor: ok ? G.roots : '#E5CF9F' }}>
            {ok ? <Ionicons name="checkmark" size={15} color={G.ink} /> : null}
          </View>
          <GardenText variant={ok ? 'body' : 'bodyStrong'} color={ok ? G.inkSoft : G.ink} style={{ flex: 1 }}>{ok ? `${n} mois d'épargne disponible` : rootsGoal(n)}</GardenText>
        </View>
      ))}
      {tree.roots.beyondSix ? <GardenText variant="small" color={G.inkSoft}>Au-delà de 6 mois : {months(tree.roots.extraMonths)} mois de plus, qui pourraient faire pousser tes branches.</GardenText> : null}
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
        left={<>{stepCard}{rootsCard}</>}
        right={<>{allocCard}{figures}</>}
      />

      <MarginSheet visible={editing === 'margin'} onClose={() => setEditing(null)} userId={core.userId} />
      <EstimateSheet visible={editing === 'weekly'} onClose={() => setEditing(null)} userId={core.userId} />

      <RecoModeModal visible={showRecoMode} onClose={() => setShowRecoMode(false)} userId={core.userId} />
      {showReliability && reliability ? (
        <ProfileReliabilitySheet reliability={reliability} onClose={() => setShowReliability(false)} onNavigate={(route) => go(route)} />
      ) : null}
    </GardenPage>
  );
}
