/**
 * MON JARDIN — l'accueil de la nouvelle interface (refonte « arbre qui pousse »).
 *
 * Quatre blocs au plus, le détail s'ouvre par-dessus :
 *   1. l'arbre, dessiné d'après la situation réelle, chaque partie touchable ;
 *   2. ton Relyka et les choix de Pico (les recommandations, en gestes à faire dans sa banque) ;
 *   3. le prochain pas (renforcer ses racines) ;
 *   4. le tour du jardin (mise à jour des soldes).
 *
 * Les chiffres sont ceux du Pilotage (usePilotageCore) : même moteur, autre habit.
 */
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import GardenSheet from '../../components/garden/GardenSheet';
import { useSetMonthlyReservation } from '../../hooks/data/useReservations';
import { useAuth } from '../../contexts/AuthContext';
import { sanitizeAmountInput } from '../../lib/ui/amountInput';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import GardenPage, { GardenColumns, GardenWaiting } from '../../components/garden/GardenPage';
import GardenText from '../../components/garden/GardenText';
import GardenIcon from '../../components/garden/GardenIcon';
import RelykaSheet from '../../components/garden/RelykaSheet';
import GardenCard from '../../components/garden/GardenCard';
import GardenButton from '../../components/garden/GardenButton';
import GardenBar from '../../components/garden/GardenBar';
import GardenScene from '../../components/garden/GardenScene';
import PicoChoicesSheet from '../../components/garden/PicoChoicesSheet';
import TreePartSheet from '../../components/garden/TreePartSheet';
import MonthlyClosure from '../../components/closure/MonthlyClosure';
import { useGardenModel } from '../../hooks/garden/useGardenModel';
import AdSlot from '../../components/marketing/AdSlot';
import GardenTip from '../../components/garden/GardenTip';
import { useGuide } from '../../contexts/GuideContext';
import { useGardenCosmetics } from '../../hooks/garden/useGardenCosmetics';
import { useMonthlyClosure } from '../../hooks/pilotage/useMonthlyClosure';
import { signalAppReady } from '../../lib/platform/splashGate';
import { gardenRelykaZero } from '../../lib/garden/relykaWords';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { formatEuros } from '../../lib/garden/picoChoices';
import type { HotspotPart } from '../../lib/garden/sceneTypes';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { live } from '../../lib/garden/live';
import { pointer } from '../../lib/ui/webLayout';
import { WORDS } from '../../lib/garden/lexicon';
import { computeNextStep } from '../../lib/garden/nextStep';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const months = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
/** « d'octobre », « de mars » : le mois en cours, avec l'élision. */
const monthOf = () => {
  const m = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  return /^[aeiouyh]/i.test(m) ? `d'${m}` : `de ${m}`;
};
/** Les trois parts de la jauge ; une couleur = un sens, la même partout. */
const GAUGE = live(() => [
  { key: 'spent', label: WORDS.spent, color: GARDEN_COLORS.fruits },
  { key: 'planned', label: 'Prévu', color: GARDEN_COLORS.water },
  { key: 'free', label: 'Libre', color: GARDEN_COLORS.primary },
] as const);

export default function JardinScreen() {
  const router = useRouter();
  const guide = useGuide();
  const { core, tree, choices, can, credits, inputs, investments } = useGardenModel();
  /* Un choix de Pépin ouvre DIRECTEMENT sa saisie, comme avant :
     racines / fruits → le virement pré-rempli ; arrosoir → le montant à conserver.
     Les fleurs (le confort) ne sont qu'une INFORMATION — « c'est pour toi » : rien à saisir, la ligne
     n'est pas un bouton (elle ouvrait une dépense, que personne n'avait à faire). */
  const monthYear = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const [keepOpen, setKeepOpen] = useState(false);
  const [keepDraft, setKeepDraft] = useState('');
  const setMonthlyReservation = useSetMonthlyReservation(core.userId);
  const { isImpersonating } = useAuth();
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
  /* Décor, garde-robe de Pépin et saison choisis en boutique (sinon, la vraie saison). */
  const gardenLook = useGardenCosmetics();
  const { vm, pilotageData: p } = core;
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(core.userId);
  const [part, setPart] = useState<HotspotPart | null>(null);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [relykaOpen, setRelykaOpen] = useState(false);
  /* ?open=can (« Suivi du mois » du menu de bureau, liens vers l'ancien onglet « Ce mois ») ouvre la
     fiche de l'arrosoir, qui porte désormais le mois. `t` change à chaque appui : l'écran reste monté. */
  const params = useLocalSearchParams<{ open?: string; t?: string }>();
  useEffect(() => { if (params.open === 'can') setPart('can'); }, [params.open, params.t]);
  const [refreshing, setRefreshing] = useState(false);

  // Le Jardin remplace le Pilotage comme écran d'arrivée : c'est donc lui qui lève le splash.
  useEffect(() => {
    if (core.ready || core.failed || core.isOffline) { signalAppReady(); return; }
    const t = setTimeout(signalAppReady, 900);
    return () => clearTimeout(t);
  }, [core.ready, core.failed, core.isOffline]);

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
  // dans le langage de l'arrosoir (lib/garden/relykaWords) ; même règle de tons que le moteur
  const zero = gardenRelykaZero(vm);
  const zeroWord = zero?.word ?? null;
  const range = vm.relConf?.relykaRange;
  const totalChoices = choices.reduce((s, c) => s + c.amount, 0);
  /* La jauge : dépensé + encore prévu + libre (= le Relyka). */
  const free = zeroWord ? 0 : Math.max(0, vm.relykaAffiche);
  const gaugeTotal = can ? Math.max(0, can.spent) + Math.max(0, can.leftToSpend) + free : 0;

  /* ── Prochain pas : UN geste, le plus utile d'abord (lib/garden/nextStep) ── */
  const step = computeNextStep(tree, inputs.monthlyReference, inputs.investedValue, inputs.recurringInvestMonthly);
  const stepLook = GARDEN_ICONS[step.part];
  const showClosure = closureEnabled && pendingMonths.length > 0;

  return (
    <GardenPage calculator="jardin" refreshing={refreshing} onRefresh={refresh}
      footer={(
        <View style={{ gap: 6 }}>
          <GardenButton label={WORDS.gardenTour} onPress={() => router.push('/(tabs)/comptes/solde' as any)} />
          <GardenText variant="small" color={GARDEN_COLORS.muted} center>{WORDS.gardenTourHint} · 30 secondes</GardenText>
        </View>
      )}
    >
      {/* Installation en cours (guide de démarrage, ou compte vidé de ses données) : la page
          « Plante ton arbre » porte les cinq étapes. */}
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
          <Pressable onPress={() => setPart('can')} accessibilityRole="button"
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

      {/* Bureau : la répartition à gauche, l'arbre et le prochain pas à droite (une colonne sur téléphone). */}
      <GardenColumns ratio={0.5} left={<>

      {/* ── 2. Que faire de ton Relyka : les choix de Pépin, une ligne par geste ── */}
      {choices.length ? (
      <GardenCard>
        <GardenText variant="heading">Que faire de {zeroWord ? 'ton Relyka' : `ces ${eur(totalChoices)}`} ?</GardenText>
        {choices.length ? (
          <View style={{ borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: GARDEN_COLORS.line, overflow: 'hidden' }}>
            {choices.map((c, i) => {
              const look = CHOICE_LOOKS[c.type];
              const row = { flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 58, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: GARDEN_COLORS.line } as const;
              const content = (
                <>
                  <GardenIcon icon={look.icon} fg={look.fg} bg={look.bg} />
                  <View style={{ flex: 1 }}>
                    <GardenText variant="bodyStrong">{look.verb}</GardenText>
                    <GardenText variant="small" color={GARDEN_COLORS.muted} numberOfLines={1}>{c.kind === 'transfer' && c.to ? `vers ${c.to}` : look.meaning}</GardenText>
                  </View>
                  <GardenText variant="bodyStrong" tabular color={look.fg}>{eur(c.amount)}</GardenText>
                </>
              );
              // le confort est une information, pas une action : une ligne simple, sans retour au toucher
              if (c.type === 'enjoy') return <View key={c.type} accessible accessibilityLabel={`${look.verb}, ${look.meaning} : ${eur(c.amount)}`} style={[row, { backgroundColor: GARDEN_COLORS.card }]}>{content}</View>;
              return (
                <Pressable key={c.type} onPress={() => actChoice(c)} accessibilityRole="button" accessibilityLabel={`${look.verb}, ${look.meaning} : ${eur(c.amount)}`}
                  style={({ pressed, hovered }: any) => [row, { backgroundColor: pressed || hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card }, pointer]}>
                  {content}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {/* Chaque ligne (sauf le confort) ouvre directement sa saisie (comme les recommandations du Pilotage). Les virements
            « plus tard » et le réglage de la répartition restent dans les choix de Pépin. */}
        {choices.length ? <GardenButton label="Plus tard, répartition…" variant="secondary" onPress={() => setChoicesOpen(true)} /> : null}
      </GardenCard>
      ) : null}

      </>} right={<>

      {/* ── 3. L'arbre : le décor, qui suit la situation ; chaque partie ouvre sa fiche ── */}
      <GardenScene state={tree} options={{ id: 'home', ...gardenLook }} onPressPart={(pt) => (pt === 'pico' ? router.push('/(tabs)/pepin' as any) : setPart(pt))} />

      {/* ── 4. Prochain pas ── */}
      {/* La carte mène là où le geste se fait : crédits, parcours, ajout d'un placement, placements. */}
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

      {/* Le conseil du jour : en bas de page, il ne passe pas devant ce qui compte (réglable dans les Paramètres) */}
      <GardenTip core={core} />

      {/* Zone publicité (maison) — bas de page, réglée en admin, masquée pour les Premium */}
      <AdSlot placement="jardin" />

      <RelykaSheet visible={relykaOpen} onClose={() => setRelykaOpen(false)} core={core} />
      <TreePartSheet part={part} onClose={() => setPart(null)} tree={tree} can={can} credits={credits} core={core}
        savingsTotal={p.total_savings ?? p.current_savings ?? 0} investedTotal={p.total_invested ?? 0} enjoyAmount={inputs.enjoyThisMonth} investments={investments} />
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
