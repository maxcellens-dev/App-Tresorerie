/**
 * MON PARCOURS — fusion de l'ancien « Mon parcours » et du « Profil financier » : les deux parlaient
 * de la même chose (où tu en es, et ce que ça change pour ton Relyka).
 *
 * Rien de nouveau n'est calculé, tout vient des mêmes sources que l'écran Profil financier :
 *   - le palier (PROFILE_INFO / resolveProfileId) et sa fiabilité (useProfileReliability) ;
 *   - le PROCHAIN PALIER : les critères du classement, avec les seuils de la base, et où tu en es
 *     (lib/finance/nextStepCriteria) ;
 *   - TON PARCOURS : la frise des neuf étapes, qui s'ouvre sur chacune ; le détail de TON étape porte
 *     la répartition appliquée (appliedAllocation, jamais une copie) et le réglage manuel ;
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
import { MarginSheet, EstimateSheet, LeftToSpendSheet } from '../../../components/garden/MonthSettingsSheets';
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
import { WORDS } from '../../../lib/garden/lexicon';
import { CHOICE_LOOKS } from '../../../lib/garden/choiceLooks';
import { CLASSED_PROFILES } from '../../../lib/garden/gardenRules';
import { nextStepCriteria } from '../../../lib/finance/nextStepCriteria';
import { pointer } from '../../../lib/ui/webLayout';
import { GARDEN_FONTS as GF } from '../../../lib/garden/fontFamilies';

const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

/* Chaque part du Relyka : le geste de Pépin (mêmes mots et couleurs que le Jardin, lib/garden/choiceLooks). */
const ALLOC = live(() => (['save', 'invest', 'enjoy', 'keep'] as const).map((key) => {
  const l = CHOICE_LOOKS[key];
  return { key, label: l.verb, part: l.meaning, fill: l.fill, track: l.bg, fg: l.fg };
}));

type Editing = null | 'margin' | 'weekly' | 'forecast';

export default function ParcoursScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { core } = useGardenModel();
  const p = core.pilotageData;
  const { data: fp } = useFinancialProfile(core.userId);
  const { data: allocTable } = useProfileAllocations();
  const { data: userProfile } = useProfile(core.userId);
  const reliability = useProfileReliability(core.userId);
  const [showRecoMode, setShowRecoMode] = useState(false);
  const [showReliability, setShowReliability] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  // Étapes REPLIÉES : la page s'ouvre sur l'essentiel, le détail se déplie au besoin.
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

  /* ── Le prochain palier : ce qu'il faut pour passer à l'étape suivante, critère par critère ── */
  const nextStep = nextStepCriteria(pid, thresholds, { months: cushion.months, savings: p?.current_savings ?? 0, invested: p?.total_invested ?? 0 });
  const fmtCrit = (v: number, unit: string | null) => (unit === 'months' ? `${months(v)} mois` : unit === 'pct' ? `${v} %` : eur(v));
  const nextCard = nextStep ? (
    <GardenCard>
      <GardenText variant="label">Prochain palier</GardenText>
      <GardenText variant="heading">{PROFILE_INFO[nextStep.next].emoji} {PROFILE_INFO[nextStep.next].name}</GardenText>
      {nextStep.criteria.map((c) => (
        <View key={c.key} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: GARDEN_SPACE.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <Ionicons name={c.met ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={c.met ? G.primary : G.muted} />
              <GardenText variant="bodyStrong" style={{ flex: 1 }}>{c.label}</GardenText>
            </View>
            {c.target != null && c.current != null ? <GardenText variant="smallStrong" tabular color={c.met ? G.primary : G.inkSoft}>{fmtCrit(c.current, c.unit)} / {fmtCrit(c.target, c.unit)}</GardenText> : null}
          </View>
          {c.target != null && c.current != null && !c.met ? <GardenBar value={c.target > 0 ? c.current / c.target : 1} fill={G.primary} track={G.track} accessibilityLabel={`${c.label} : ${fmtCrit(c.current, c.unit)} sur ${fmtCrit(c.target, c.unit)}`} /> : null}
        </View>
      ))}
    </GardenCard>
  ) : pid === 'P9' ? (
    <GardenCard>
      <GardenText variant="label">Prochain palier</GardenText>
      <GardenText variant="heading">Tu es à la dernière étape</GardenText>
      <GardenText variant="body" color={G.inkSoft}>Il n'y a plus de palier au-dessus : Pépin t'aide maintenant à faire durer ce que tu as construit.</GardenText>
    </GardenCard>
  ) : null;

  /* ── Ton parcours : la frise des neuf étapes ; elle s'ouvre sur la liste, chaque étape sur son détail ── */
  const pidIdx = pid ? CLASSED_PROFILES.indexOf(pid as any) : -1;
  const ladderCard = (
    <GardenCard>
      <Pressable onPress={() => setLadderOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: ladderOpen }}
        accessibilityLabel={`Ton parcours : ${pidIdx >= 0 ? `étape ${pidIdx + 1} sur ${CLASSED_PROFILES.length}` : 'étape à venir'}. ${ladderOpen ? 'Replier' : 'Voir les étapes'}`}
        style={[{ gap: GARDEN_SPACE.sm }, pointer]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <GardenText variant="heading" style={{ flex: 1 }}>Ton parcours</GardenText>
          <Ionicons name={ladderOpen ? 'chevron-up' : 'chevron-down'} size={20} color={G.muted} />
        </View>
        {/* La frise : les étapes franchies pleines, la tienne cerclée, les suivantes en attente. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible={false}>
          {CLASSED_PROFILES.map((sp, i) => {
            const here = i === pidIdx, passed = i < pidIdx;
            return (
              <View key={sp} style={{ flexDirection: 'row', alignItems: 'center', flex: i ? 1 : 0 }}>
                {i ? <View style={{ flex: 1, height: 4, backgroundColor: passed || here ? G.primary : G.track }} /> : null}
                <View style={{ width: here ? 26 : 16, height: here ? 26 : 16, borderRadius: 13, backgroundColor: here ? G.card : passed ? G.primary : G.track, borderWidth: here ? 4 : 0, borderColor: G.primary }} />
              </View>
            );
          })}
        </View>
        <GardenText variant="small" color={G.inkSoft}>{pidIdx >= 0 ? `Étape ${pidIdx + 1} sur ${CLASSED_PROFILES.length} : ${PROFILE_INFO[CLASSED_PROFILES[pidIdx]].name}` : `${CLASSED_PROFILES.length} étapes, de la plus fragile au patrimoine d'exception`}</GardenText>
      </Pressable>
      {ladderOpen ? (
      <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>
        {CLASSED_PROFILES.map((sp, i) => {
          const pi = PROFILE_INFO[sp], here = i === pidIdx, passed = pidIdx > i;
          return (
            <Pressable key={sp} onPress={() => setStepShown(sp)} accessibilityRole="button" accessibilityLabel={`${pi.name}, ${pi.tier}${here ? ', ton étape' : passed ? ', franchie' : ''}. Voir le détail`}
              style={({ hovered }: any) => [pointer, { flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: G.line, backgroundColor: here ? G.branchesBg : hovered ? G.field : G.card, opacity: here || passed ? 1 : 0.62 }]}>
              <GardenText variant="heading" style={{ width: 30, textAlign: 'center' }}>{pi.emoji}</GardenText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <GardenText variant="bodyStrong" color={here ? G.branchesText : G.ink} numberOfLines={1}>{pi.name}</GardenText>
                <GardenText variant="small" color={G.muted} numberOfLines={1}>{pi.tier}</GardenText>
              </View>
              {here ? <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: GARDEN_RADII.pill, backgroundColor: G.primary }}><GardenText variant="smallStrong" color={G.onPrimary} style={{ fontFamily: GF.body, fontSize: 11 }}>Tu es ici</GardenText></View>
                : passed ? <Ionicons name="checkmark-circle" size={18} color={G.branches} /> : null}
              <Ionicons name="chevron-forward" size={16} color={G.muted} />
            </Pressable>
          );
        })}
      </View>
      ) : null}
      {pid === 'P0' || !pid ? <GardenText variant="small" color={G.muted}>Ton étape apparaîtra dès que tes comptes et tes rentrées d'argent seront renseignés.</GardenText> : null}
    </GardenCard>
  );

  /* ── Tes chiffres : ce que l'app mesure, puis ce que toi seul peux dire ── */
  const figures = (
    <>
      <GardenRowGroup title="Ce que l'app mesure" rows={[
        { key: 'cushion', label: 'Matelas de sécurité', sub: cushion.months != null ? securityBaseLabel(cushion.base) : 'ajoute un compte d’épargne pour le calculer', value: cushion.months != null ? securityMonthsLabel(cushion.months) : '—', icon: 'shield-checkmark-outline', iconColor: G.rootsText, iconBg: G.rootsBg },
        { key: 'income', label: 'Revenu de référence', sub: (p?.avg_monthly_income ?? 0) > 0 ? 'moyenne de tes recettes sur 6 mois' : 'saisis tes rentrées d’argent pour l’affiner', value: (p?.avg_monthly_income ?? 0) > 0 ? eur(p!.avg_monthly_income) : '—', icon: 'cash-outline', iconColor: G.branchesText, iconBg: G.branchesBg },
        { key: 'variable', label: 'Dépenses variables', sub: p?.variable_envelope_source === 'history' ? `moyenne réelle sur ${p.variable_envelope_months_used} mois` : 'ton estimation, en attendant 2 mois d’historique', value: (p?.variable_envelope_initial ?? 0) > 0 ? `${eur(p!.variable_envelope_initial)} / mois` : '—', icon: 'cart-outline', iconColor: G.flowersText, iconBg: G.flowersBg, onPress: () => setEditing('forecast') },
      ]} />
      <GardenRowGroup title="Ce que tu nous dis" rows={[
        { key: 'margin', label: WORDS.minimumToKeep, sub: 'toujours gardé sur ton compte courant', value: margin > 0 ? eur(margin) : 'aucune', icon: GARDEN_ICONS.water.icon, iconColor: GARDEN_ICONS.water.fg, iconBg: GARDEN_ICONS.water.bg, onPress: () => setEditing('margin') },
        { key: 'weekly', label: 'Dépenses du quotidien (estimation)', sub: 'sert tant que tu n’as pas 2 mois d’historique', value: weekly > 0 ? `${eur(weekly)} / sem.` : 'estimé pour toi', icon: 'create-outline', iconColor: G.picoText, iconBg: G.pico, onPress: () => setEditing('weekly') },
      ]} />
    </>
  );


  return (
    <GardenPage secondary header={<ScreenHeader title={WORDS.myJourney} onBack={goBack} />}>
      <GardenColumns ratio={0.5}
        left={<>{stepCard}{nextCard}{ladderCard}</>}
        right={figures}
      />

      <MarginSheet visible={editing === 'margin'} onClose={() => setEditing(null)} userId={core.userId} />
      <EstimateSheet visible={editing === 'weekly'} onClose={() => setEditing(null)} userId={core.userId} />
      {/* La prévision des dépenses du quotidien (même fiche que « Encore prévu ce mois-ci ») */}
      {p ? (
        <LeftToSpendSheet visible={editing === 'forecast'} onClose={() => setEditing(null)} userId={core.userId} pilotageData={p} pilotageQuery={core.pilotageQuery as any}
          recurringLeft={Math.max(0, core.vm.recurUpcoming.amount)} recurringCount={core.vm.recurUpcoming.count} relykaBefore={core.vm.relykaAffiche}
          breakdownExtras={{ reservationsTotal: core.vm.reservationsTotal, preEpargneTotal: core.vm.preEpargneTotal, preInvestTotal: core.vm.preInvestTotal }}
          onShowRecurring={() => { setEditing(null); go('/(tabs)/(secondary)/recurrentes'); }}
          onEditEstimate={() => { setEditing(null); setTimeout(() => setEditing('weekly'), 60); }} />
      ) : null}

      {stepShown ? (() => {
        const sp = PROFILE_INFO[stepShown];
        const mine = stepShown === pid;
        const sAlloc = appliedAllocation(stepShown, mine ? recoMode.manualAllocation : null, allocTable);
        const idx = CLASSED_PROFILES.indexOf(stepShown);
        return (
          <GardenSheet visible onClose={() => setStepShown(null)} title={`${sp.emoji} ${sp.name}`} subtitle={`Étape ${idx + 1} sur ${CLASSED_PROFILES.length} · ${sp.tier}`}>
            <GardenCard tint={G.branchesBg}>
              <GardenText variant="label" color={G.branchesText}>{stepShown === pid ? 'Tu es ici' : idx < pidIdx ? 'Étape franchie' : 'Pour y arriver'}</GardenText>
              <GardenText variant="bodyStrong">{stepCondition(stepShown, thresholds)}</GardenText>
            </GardenCard>
            <GardenText variant="body" color={G.inkSoft}>{sp.description}</GardenText>
            <GardenText variant="label">{mine && recoMode.mode === 'manual' ? 'Ta répartition (réglée à la main)' : 'Comment Pépin répartit ton Relyka à cette étape'}</GardenText>
            {ALLOC.map((a) => (
              <View key={a.key} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: GARDEN_SPACE.md }}>
                  <GardenText variant="bodyStrong" color={a.fg} style={{ flex: 1, minWidth: 0 }}>{a.label}</GardenText>
                  <GardenText variant="bodyStrong" color={a.fg} tabular style={{ flexShrink: 0 }}>{sAlloc[a.key]} %</GardenText>
                </View>
                <GardenBar value={sAlloc[a.key] / 100} fill={a.fill} track={a.track} accessibilityLabel={`${a.label} : ${sAlloc[a.key]} %`} />
              </View>
            ))}
            {mine ? <GardenButton label="Répartir manuellement" variant="secondary" onPress={() => { setStepShown(null); setTimeout(() => setShowRecoMode(true), 60); }} /> : null}
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
