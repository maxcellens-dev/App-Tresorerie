/**
 * ACCUEIL — « où j'en suis ce mois-ci », en quatre blocs, le détail s'ouvre par-dessus :
 *   1. ton Relyka : UN chiffre, et d'où il vient en une jauge (dépensé / prévu / libre) ;
 *   2. le plan de Pépin : les QUATRE recommandations (épargner, investir, conserver, plaisir), chacune
 *      dépliable sur la remarque de Pépin qui l'explique et le geste à faire. Relyka épuisé : Pépin le
 *      dit en un mot, avec le compte à rebours jusqu'à la prochaine rentrée (qui ramène des recos) ;
 *   3. à venir : les prochaines opérations du mois ;
 *   4. le prochain pas.
 * Les remarques sans recommandation et le conseil du jour sont sur la page de Pépin.
 *
 * Les chiffres sont ceux du Pilotage (usePilotageCore) : même moteur, autre habit.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import GardenSheet from '../../components/garden/GardenSheet';
import GardenPage, { GardenColumns, GardenWaiting } from '../../components/garden/GardenPage';
import GardenText from '../../components/garden/GardenText';
import GardenIcon from '../../components/garden/GardenIcon';
import GardenCard from '../../components/garden/GardenCard';
import GardenButton from '../../components/garden/GardenButton';
import GardenBar from '../../components/garden/GardenBar';
import Pico from '../../components/garden/Pico';
import RelykaSheet from '../../components/garden/RelykaSheet';
import PicoChoicesSheet from '../../components/garden/PicoChoicesSheet';
import MonthSheet from '../../components/garden/MonthSheet';
import { UpcomingRows } from '../../components/garden/UpcomingList';
import MonthlyClosure from '../../components/closure/MonthlyClosure';
import AdSlot from '../../components/marketing/AdSlot';
import { useSetMonthlyReservation } from '../../hooks/data/useReservations';
import { useAuth } from '../../contexts/AuthContext';
import { useGuide } from '../../contexts/GuideContext';
import { useGardenModel } from '../../hooks/garden/useGardenModel';
import { useMonthlyClosure } from '../../hooks/pilotage/useMonthlyClosure';
import { signalAppReady } from '../../lib/platform/splashGate';
import { gardenRelykaZero } from '../../lib/garden/relykaWords';
import { computeMonthUpcoming } from '../../lib/finance/monthUpcoming';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { formatEuros } from '../../lib/garden/picoChoices';
import { sanitizeAmountInput } from '../../lib/ui/amountInput';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { live } from '../../lib/garden/live';
import { pointer } from '../../lib/ui/webLayout';
import { WORDS } from '../../lib/garden/lexicon';
import { computeNextStep } from '../../lib/garden/nextStep';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import { todayISO } from '../../lib/dateUtils';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
/** « d'octobre », « de mars » : le mois en cours, avec l'élision. */
const monthOf = () => {
  const m = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  return /^[aeiouyh]/i.test(m) ? `d'${m}` : `de ${m}`;
};
const dayLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
/** Jours entiers entre aujourd'hui et `iso` (0 = aujourd'hui). */
const daysUntil = (iso: string) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000);
/** Les trois parts de la jauge ; une couleur = un sens, la même partout. */
const GAUGE = live(() => [
  { key: 'spent', label: WORDS.spent, color: GARDEN_COLORS.fruits },
  { key: 'planned', label: 'Prévu', color: GARDEN_COLORS.water },
  { key: 'free', label: 'Libre', color: GARDEN_COLORS.primary },
] as const);
const UPCOMING_SHOWN = 3;

export default function JardinScreen() {
  const router = useRouter();
  const guide = useGuide();
  const { core, tree, choices, can, inputs } = useGardenModel();
  const monthYear = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const [keepOpen, setKeepOpen] = useState(false);
  const [keepDraft, setKeepDraft] = useState('');
  const setMonthlyReservation = useSetMonthlyReservation(core.userId);
  const { isImpersonating } = useAuth();
  /* Le geste de chaque reco : épargner / investir → le virement pré-rempli ; conserver → le montant
     gardé sur le compte. Le plaisir n'a pas de geste : « c'est pour toi ». */
  const actChoice = (c: { type: string; amount: number }) => {
    if (c.type === 'save' || c.type === 'invest') {
      const dest = c.type === 'save' ? 'savings' : 'investment';
      router.push(core.buildTransferUrl({ dest, amount: c.amount, label: `${c.type === 'save' ? 'Épargne' : 'Investissement'} ${monthYear()}` }) as any);
      return;
    }
    if (c.type === 'keep') { setKeepDraft(String(Math.round((core.vm.reservationsTotal ?? 0) + c.amount))); setKeepOpen(true); }
  };
  const saveKeep = () => {
    if (isImpersonating) { setKeepOpen(false); return; }
    const val = Math.max(0, Math.round(parseFloat(keepDraft.replace(',', '.')) || 0));
    setMonthlyReservation.mutate({ montant: val, libelle: `Réservé ${monthYear()}` });
    setKeepOpen(false);
  };
  const { vm, pilotageData: p } = core;
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(core.userId);
  const [monthOpen, setMonthOpen] = useState(false);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [relykaOpen, setRelykaOpen] = useState(false);
  // La reco dépliée du plan de Pépin (une seule à la fois).
  const [openReco, setOpenReco] = useState<string | null>(null);
  /* ?open=can (« Suivi du mois » du menu de bureau) ouvre le suivi du mois. `t` change à chaque
     appui : l'écran reste monté. */
  const params = useLocalSearchParams<{ open?: string; t?: string }>();
  useEffect(() => { if (params.open === 'can') setMonthOpen(true); }, [params.open, params.t]);
  const [refreshing, setRefreshing] = useState(false);

  // L'accueil est l'écran d'arrivée : c'est donc lui qui lève le splash.
  useEffect(() => {
    if (core.ready || core.failed || core.isOffline) { signalAppReady(); return; }
    const t = setTimeout(signalAppReady, 900);
    return () => clearTimeout(t);
  }, [core.ready, core.failed, core.isOffline]);

  /* À venir : mêmes lignes que le suivi du mois (lib/finance/monthUpcoming). */
  const refCode = (core.profile as any)?.currency_code ?? 'EUR';
  const upcoming = useMemo(() => computeMonthUpcoming({
    recurringExpenses: vm?.recurUpcoming?.list ?? [],
    txForSuivi: core.txForSuivi as any[],
    accountsForSuivi: core.accountsForSuivi as any[],
    refCode,
    rates: core.rates,
  }), [vm?.recurUpcoming, core.txForSuivi, core.accountsForSuivi, refCode, core.rates]);

  const refresh = async () => {
    setRefreshing(true);
    try { await core.pilotageQuery.refetch?.(); } finally { setRefreshing(false); }
  };

  if (!core.ready || !p) {
    return (
      <GardenPage>
        <GardenWaiting message={core.failed ? "Ton accueil n'a pas pu se charger. Tire vers le bas pour réessayer." : core.isOffline ? 'Hors connexion : tes chiffres attendent le réseau.' : 'Tes chiffres se préparent…'} />
      </GardenPage>
    );
  }

  /* ── Ton Relyka : un chiffre, ou un mot quand il est à zéro (règle « un mot, pas un chiffre ») ── */
  const zero = gardenRelykaZero(vm);
  const zeroWord = zero?.word ?? null;
  const range = vm.relConf?.relykaRange;
  const totalChoices = choices.reduce((s, c) => s + c.amount, 0);
  /* La jauge : dépensé + encore prévu + libre (= le Relyka). */
  const free = zeroWord ? 0 : Math.max(0, vm.relykaAffiche);
  const gaugeTotal = can ? Math.max(0, can.spent) + Math.max(0, can.leftToSpend) + free : 0;
  /* Les remarques de Pépin, rangées sous la reco qu'elles expliquent ; le texte après « 💡 » est son conseil. */
  const remarksFor = (type: string) => (vm.recoMessages ?? []).filter((m: any) => m.recoType === type && m.text).map((m: any) => {
    const [fact, ...tips] = String(m.text).split('💡').map((s: string) => s.trim());
    return { key: m.key as string, fact, tip: tips.join(' ').trim() };
  });
  /* Relyka épuisé : le compte à rebours jusqu'à la prochaine rentrée, qui ramènera des recos. */
  const nextIncome = vm.nextIncomeDate ? { date: vm.nextIncomeDate as string, days: daysUntil(vm.nextIncomeDate), amount: Number(vm.nextIncomeAmount ?? 0) } : null;

  /* ── Prochain pas : UN geste, le plus utile d'abord (lib/garden/nextStep) ── */
  const step = computeNextStep(tree, inputs.monthlyReference, inputs.investedValue, inputs.recurringInvestMonthly);
  const stepLook = GARDEN_ICONS[step.part];
  const showClosure = closureEnabled && pendingMonths.length > 0;

  const plan = choices.length && !zeroWord ? (
    <GardenCard>
      <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.md, alignItems: 'center' }}>
        <Pico avatar size={48} mood="happy" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <GardenText variant="heading">Le plan de Pépin</GardenText>
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>Voici comment je répartirais tes {eur(totalChoices)}. Touche une ligne pour savoir pourquoi.</GardenText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 3 }}>
        {choices.map((c) => <View key={c.type} style={{ flex: c.amount, backgroundColor: CHOICE_LOOKS[c.type].fill }} />)}
      </View>
      <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: GARDEN_COLORS.line, overflow: 'hidden' }}>
        {choices.map((c, i) => {
          const look = CHOICE_LOOKS[c.type];
          const isOpen = openReco === c.type;
          const remarks = remarksFor(c.type);
          const action = c.type === 'save' || c.type === 'invest' ? `Faire le virement de ${eur(c.amount)}` : c.type === 'keep' ? 'Ajuster ce que je garde' : null;
          return (
            <View key={c.type} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: GARDEN_COLORS.line, backgroundColor: GARDEN_COLORS.card }}>
              <Pressable onPress={() => setOpenReco(isOpen ? null : c.type)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={`${look.verb} : ${eur(c.amount)}. ${isOpen ? 'Replier' : 'Voir pourquoi'}`}
                style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: pressed || hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card }, pointer]}>
                <GardenIcon icon={look.icon} fg={look.fg} bg={look.bg} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <GardenText variant="bodyStrong">{look.verb}</GardenText>
                  <GardenText variant="small" color={GARDEN_COLORS.muted} numberOfLines={1}>{c.kind === 'transfer' && c.to ? `vers ${c.to}` : look.meaning}</GardenText>
                </View>
                <GardenText variant="bodyStrong" tabular color={look.fg}>{eur(c.amount)}</GardenText>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={GARDEN_COLORS.muted} />
              </Pressable>
              {isOpen ? (
                <View style={{ gap: GARDEN_SPACE.sm, paddingHorizontal: 12, paddingBottom: 12 }}>
                  {remarks.length ? remarks.map((r) => (
                    <View key={r.key} style={{ gap: GARDEN_SPACE.sm }}>
                      {r.fact ? <GardenText variant="body">{r.fact}</GardenText> : null}
                      {r.tip ? (
                        <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm, padding: 10, borderRadius: GARDEN_RADII.md, backgroundColor: look.bg }}>
                          <Ionicons name="bulb-outline" size={16} color={look.fg} style={{ marginTop: 2 }} />
                          <GardenText variant="smallStrong" color={look.fg} style={{ flex: 1 }}>{r.tip}</GardenText>
                        </View>
                      ) : null}
                    </View>
                  )) : <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>{look.meaning.charAt(0).toUpperCase() + look.meaning.slice(1)}.</GardenText>}
                  {action ? <GardenButton label={action} variant="secondary" onPress={() => actChoice(c)} /> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <GardenButton label="Plus tard, répartition…" variant="secondary" onPress={() => setChoicesOpen(true)} />
    </GardenCard>
  ) : (
    /* Relyka épuisé (ou rien à répartir) : Pépin le dit en un mot, et suit la prochaine rentrée. */
    <GardenCard>
      <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.md, alignItems: 'center' }}>
        <Pico avatar size={48} mood="thinking" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <GardenText variant="heading">{zeroWord ?? 'Rien à répartir pour l’instant'}</GardenText>
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{nextIncome ? 'Mon prochain plan arrive avec ta prochaine rentrée.' : 'Mon prochain plan arrivera avec ta prochaine rentrée d’argent.'}</GardenText>
        </View>
      </View>
      {nextIncome && nextIncome.days >= 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: GARDEN_SPACE.sm }}>
            <GardenText variant="bodyStrong">{nextIncome.days === 0 ? "Aujourd'hui" : nextIncome.days === 1 ? 'Demain' : `Dans ${nextIncome.days} jours`}</GardenText>
            <GardenText variant="small" color={GARDEN_COLORS.muted}>{dayLabel(nextIncome.date)}{nextIncome.amount > 0 ? ` · + ${eur(nextIncome.amount)}` : ''}</GardenText>
          </View>
          {/* Le mois qui s'écoule jusqu'à la rentrée : la barre se remplit chaque jour. */}
          <GardenBar value={Math.max(0.04, 1 - Math.min(nextIncome.days, 31) / 31)} fill={GARDEN_COLORS.primary} track={GARDEN_COLORS.track} accessibilityLabel={`Prochaine rentrée dans ${nextIncome.days} jours`} />
        </View>
      ) : null}
    </GardenCard>
  );

  const upcomingCard = upcoming.items.length ? (
    <View style={{ gap: GARDEN_SPACE.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
        <GardenText variant="heading">À venir</GardenText>
        <Pressable onPress={() => setMonthOpen(true)} accessibilityRole="button" hitSlop={8} style={pointer}>
          <GardenText variant="smallStrong" color={GARDEN_COLORS.primary}>Tout voir ›</GardenText>
        </Pressable>
      </View>
      <UpcomingRows items={upcoming.items.slice(0, UPCOMING_SHOWN)} onOpen={(it) => {
        const id = String(it.tx?.id ?? '');
        router.push((it.tx?.credit_id || it.tx?.is_credit_flow || id.startsWith('credit') ? '/(tabs)/(secondary)/credits' : `/(tabs)/transactions/edit/${id}`) as any);
      }} />
    </View>
  ) : null;

  return (
    <GardenPage calculator="jardin" refreshing={refreshing} onRefresh={refresh}
      footer={(
        <View style={{ gap: 6 }}>
          <GardenButton label={WORDS.gardenTour} onPress={() => router.push('/(tabs)/comptes/solde' as any)} />
          <GardenText variant="small" color={GARDEN_COLORS.muted} center>{WORDS.gardenTourHint} · 30 secondes</GardenText>
        </View>
      )}
    >
      {/* Installation en cours (guide de démarrage, ou compte vidé de ses données) */}
      {guide.active || vm.noAccountsYet || vm.setupIncomplete ? (
        <GardenCard tint={GARDEN_COLORS.branchesBg} onPress={() => router.push('/(tabs)/(secondary)/demarrer' as any)} accessibilityLabel="Finir de démarrer">
          <GardenText variant="label" color={GARDEN_COLORS.branchesText}>Démarrer</GardenText>
          <GardenText variant="heading">Finis ton installation</GardenText>
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{vm.setupHint || 'Cinq étapes avec tes vrais comptes, environ cinq minutes : ton Relyka se calcule ensuite tout seul.'}</GardenText>
          <GardenText variant="smallStrong" color={GARDEN_COLORS.primary}>Continuer ›</GardenText>
        </GardenCard>
      ) : null}

      {showClosure ? (
        <MonthlyClosure variableEnvelope={p.variable_envelope_initial ?? 0} checkingAccounts={core.closureAccounts} />
      ) : null}

      {/* ── 1. UN chiffre : ton Relyka, et d'où il vient en une jauge (dépensé / prévu / libre) ──
          Le haut ouvre le détail du calcul ; la jauge ouvre le suivi du mois (deux boutons voisins,
          jamais l'un dans l'autre). */}
      <GardenCard>
        <Pressable onPress={() => setRelykaOpen(true)} accessibilityRole="button" accessibilityLabel={`${WORDS.relyka} : ${zeroWord ?? eur(vm.relykaAffiche)}. Voir le détail du calcul`}
          style={({ pressed }: any) => [{ gap: 4, opacity: pressed ? 0.75 : 1 }, pointer]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: GARDEN_SPACE.sm }}>
            <GardenText variant="bodyStrong" color={GARDEN_COLORS.inkSoft} style={{ flex: 1 }}>{WORDS.relyka}</GardenText>
            {range?.isRange ? <GardenText variant="small" color={GARDEN_COLORS.muted}>estimation</GardenText> : null}
            <GardenText variant="smallStrong" color={GARDEN_COLORS.primary}>Détail ›</GardenText>
          </View>
          {zeroWord ? (
            <>
              <GardenText variant="title">{zeroWord}</GardenText>
              <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{zero?.sub}</GardenText>
            </>
          ) : (
            <>
              <GardenText variant="amount" tabular style={{ fontSize: 52, lineHeight: 60 }} adjustsFontSizeToFit numberOfLines={1}>{eur(vm.relykaAffiche)}</GardenText>
              <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>à utiliser d'ici la fin {monthOf()}{(can?.minimum ?? 0) > 0 ? ', sans toucher à ta réserve' : ''}.</GardenText>
            </>
          )}
        </Pressable>
        {can && gaugeTotal > 0 ? (
          <Pressable onPress={() => setMonthOpen(true)} accessibilityRole="button"
            accessibilityLabel={`Ce mois : ${eur(can.spent)} dépensés, ${eur(can.leftToSpend)} encore prévus, ${eur(free)} libres. Voir le suivi du mois`}
            style={({ pressed }: any) => [{ gap: 8, paddingTop: 6, opacity: pressed ? 0.75 : 1 }, pointer]}>
            <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 3 }}>
              {GAUGE.map((g) => {
                const v = g.key === 'spent' ? can.spent : g.key === 'planned' ? can.leftToSpend : free;
                // un segment non nul reste visible, même minuscule à côté des autres
                return v > 0 ? <View key={g.key} style={{ flex: Math.max(v, gaugeTotal * 0.03), backgroundColor: g.color }} /> : null;
              })}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: GARDEN_SPACE.md, rowGap: 4 }}>
              {GAUGE.map((g) => {
                const v = g.key === 'spent' ? can.spent : g.key === 'planned' ? can.leftToSpend : free;
                return (
                  <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: g.color }} />
                    <GardenText variant="smallStrong" tabular color={GARDEN_COLORS.inkSoft}>{g.label} {eur(v)}</GardenText>
                  </View>
                );
              })}
            </View>
          </Pressable>
        ) : null}
      </GardenCard>

      {/* Bureau : le plan de Pépin à gauche, à venir et le prochain pas à droite (une colonne sur téléphone). */}
      <GardenColumns ratio={0.55} left={plan} right={<>
        {upcomingCard}

        {/* ── Prochain pas : la carte mène là où le geste se fait ── */}
        <GardenCard tint={stepLook.bg} accessibilityLabel={`${WORDS.nextStep} : ${step.title}`}
          onPress={() => router.push((step.kind === 'brambles' ? '/(tabs)/(secondary)/credits'
            : step.kind === 'roots' ? '/(tabs)/(secondary)/parcours'
            : step.kind === 'firstFruit' ? '/(tabs)/comptes/add'
            : '/(tabs)/(secondary)/placements') as any)}>
          <GardenText variant="label" color={stepLook.fg}>{WORDS.nextStep}</GardenText>
          <GardenText variant="heading">{step.title}</GardenText>
          <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{step.text}</GardenText>
          {step.progress ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
              <View style={{ flex: 1 }}><GardenBar value={step.progress.value / step.progress.target} fill={stepLook.fill} track={GARDEN_COLORS.track} accessibilityLabel={`${months(step.progress.value)} mois sur ${step.progress.target}`} /></View>
              <GardenText variant="smallStrong" tabular>{months(step.progress.value)} / {step.progress.target}</GardenText>
            </View>
          ) : null}
        </GardenCard>
      </>} />

      {/* Zone publicité (maison) — bas de page, réglée en admin, masquée pour les Premium */}
      <AdSlot placement="jardin" />

      <RelykaSheet visible={relykaOpen} onClose={() => setRelykaOpen(false)} core={core} />
      <MonthSheet visible={monthOpen} onClose={() => setMonthOpen(false)} core={core} checking={can?.checking ?? null} onUpdateBalances={() => { setMonthOpen(false); router.push('/(tabs)/comptes/solde' as any); }} />
      <GardenSheet visible={keepOpen} onClose={() => setKeepOpen(false)} title="Garder sur ton compte" subtitle="conserver ce mois-ci sur ton compte courant"
        footer={<GardenButton label="Enregistrer" onPress={saveKeep} loading={setMonthlyReservation.isPending} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm }}>
          <TextInput value={keepDraft} onChangeText={(v) => setKeepDraft(sanitizeAmountInput(v))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={GARDEN_COLORS.muted} accessibilityLabel="Montant à conserver"
            style={{ fontFamily: GF.body, flex: 1, minHeight: 56, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: GARDEN_COLORS.line, backgroundColor: GARDEN_COLORS.card, paddingHorizontal: 16, fontSize: 22, color: GARDEN_COLORS.ink }} />
          <GardenText variant="bodyStrong">{CURRENCY_SYMBOL}</GardenText>
        </View>
        <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>C'est le TOTAL que tu gardes de côté sur ton compte ce mois-ci : il est retiré de ton Relyka mais ne bouge pas. Baisse-le pour en libérer une partie, mets 0 pour tout libérer. Il repart à zéro le mois prochain.</GardenText>
      </GardenSheet>
      <PicoChoicesSheet visible={choicesOpen} onClose={() => setChoicesOpen(false)} core={core} choices={choices} />
    </GardenPage>
  );
}
