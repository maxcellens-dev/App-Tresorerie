/**
 * MON ARGENT — trois vues, sans longue page :
 *   - Aujourd'hui : comptes par type, crédits et placements (liens vers leurs pages) ;
 *   - Ce mois : le SUIVI DU MOIS — « Dépensé » (touché : le détail par catégorie et par jour),
 *     « Encore prévu » (touché : ce qui est inscrit d'ici la fin du mois, sorties ET rentrées), d'où
 *     vient l'estimation, minimum à garder, et l'accès à TOUTES les récurrentes pour les gérer ;
 *   - Demain : la trésorerie de la Projection, directement (pas de bouton pour y aller).
 *
 * Plus de page « Opérations » dans ce modèle : les opérations se consultent depuis chaque compte.
 * Les chiffres sont ceux du Pilotage (même cœur de données), jamais recalculés ici.
 */
import { live } from '../../lib/garden/live';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import GardenPage, { GardenColumns, GardenGrid, GardenWaiting } from '../../components/garden/GardenPage';
import GardenText from '../../components/garden/GardenText';
import GardenCard from '../../components/garden/GardenCard';
import GardenButton from '../../components/garden/GardenButton';
import GardenBar from '../../components/garden/GardenBar';
import GardenSegmented from '../../components/garden/GardenSegmented';
import { GardenRowGroup } from '../../components/garden/GardenList';
import RecurringTransactionsModal from '../../components/transaction/RecurringTransactionsModal';
import AdSlot from '../../components/marketing/AdSlot';
import { MarginSheet, EstimateSheet, LeftToSpendSheet } from '../../components/garden/MonthSettingsSheets';
import SpentSheet from '../../components/garden/SpentSheet';
import { UpcomingRows, UpcomingSheet } from '../../components/garden/UpcomingList';
import { ProjectionSection } from './projection';
import { useGardenModel } from '../../hooks/garden/useGardenModel';
import { useCategories } from '../../hooks/data/useCategories';
import { useRecurringTransactions } from '../../hooks/data/useRecurringTransactions';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, convertAmount, currencySymbolFor } from '../../lib/finance/currency';
import { computeMonthUpcoming, type UpcomingItem } from '../../lib/finance/monthUpcoming';
import { GARDEN_ICONS, accountIcon } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE, mixHex } from '../../lib/garden/theme';
import { MONEY_VIEWS, TABS, TREE_PARTS, WORDS } from '../../lib/garden/lexicon';
import { pointer, transition } from '../../lib/ui/webLayout';

type View3 = 'today' | 'month' | 'tomorrow';
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

/* Un groupe par type de compte. Chaque compte prend l'icône ET la couleur de SA partie de l'arbre
   (lib/garden/icons) : courant = arrosoir, épargne = racines, placements = fruits — les mêmes que
   dans la scène et sur les gestes de Pépin. */
const GROUPS: { type: string; title: string; meaning: string; color: string; bg: string; typeLabel: string }[] = live(() => ([
  { type: 'checking', title: TREE_PARTS.can.name, meaning: TREE_PARTS.can.meaning, color: GARDEN_ICONS.water.fg, bg: GARDEN_ICONS.water.bg, typeLabel: 'Courant' },
  { type: 'savings', title: TREE_PARTS.roots.name, meaning: TREE_PARTS.roots.meaning, color: GARDEN_ICONS.roots.fg, bg: GARDEN_ICONS.roots.bg, typeLabel: 'Épargne' },
  { type: 'investment', title: TREE_PARTS.branches.name, meaning: TREE_PARTS.branches.meaning, color: GARDEN_ICONS.fruits.fg, bg: GARDEN_ICONS.fruits.bg, typeLabel: 'Investissement' },
  { type: 'other', title: 'Autres comptes', meaning: '', color: GARDEN_ICONS.otherAccount.fg, bg: GARDEN_ICONS.otherAccount.bg, typeLabel: 'Autre' },
]));

/** Une ligne de détail du reste à dépenser : pastille de couleur, libellé, montant. */
function Part({ color, label, hint, value }: { color: string; label: string; hint?: string; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
      <View style={{ flex: 1 }}>
        <GardenText variant="body">{label}</GardenText>
        {hint ? <GardenText variant="small" color={G.muted}>{hint}</GardenText> : null}
      </View>
      <GardenText variant="bodyStrong" tabular>{eur(value)}</GardenText>
    </View>
  );
}

/** Un chiffre du mois qui ouvre son détail : libellé, montant, et l'invitation à toucher. */
function MonthTile({ label, value, color, bg, action, onPress, accessibilityLabel }: {
  label: string; value: string; color: string; bg: string; action: string; onPress: () => void; accessibilityLabel: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed, hovered }: any) => [{ flex: 1, minWidth: 0, gap: 2, padding: GARDEN_SPACE.md, borderRadius: GARDEN_RADII.md, backgroundColor: bg, opacity: pressed ? 0.85 : 1 },
        hovered ? { transform: [{ translateY: -1 }] } : null, pointer, transition]}>
      <GardenText variant="small" color={G.inkSoft} numberOfLines={1}>{label}</GardenText>
      <GardenText variant="title" tabular color={color} numberOfLines={1} adjustsFontSizeToFit>{value}</GardenText>
      <GardenText variant="smallStrong" color={color} numberOfLines={1}>{action} ›</GardenText>
    </Pressable>
  );
}

export default function ArgentScreen() {
  const router = useRouter();
  const { core, credits } = useGardenModel();
  const { vm, pilotageData: p } = core;
  const params = useLocalSearchParams<{ view?: string; t?: string }>();
  const asView = (v?: string): View3 | null => (v === 'today' || v === 'month' || v === 'tomorrow' ? v : null);
  const [view, setView] = useState<View3>(() => asView(params.view) ?? 'today');
  /* L'onglet reste monté : chaque lien doit quand même basculer la vue — le bouton « Mon argent »
     du menu rouvre toujours « Aujourd'hui », « Suivi du mois » rouvre « Ce mois ». `t` change à
     chaque appui : sans lui, revenir avec le même `view` qu'avant ne déclenchait rien. */
  useEffect(() => { const v = asView(params.view); if (v) setView(v); }, [params.view, params.t]);
  const [showRecurring, setShowRecurring] = useState(false);
  /** Feuille ouverte (une à la fois) : réglages du mois (mêmes que le Pilotage) ou détails du suivi. */
  const [sheet, setSheet] = useState<null | 'margin' | 'estimate' | 'left' | 'spent' | 'upcoming'>(null);
  const go = (r: string) => router.push(r as any);

  /* ── Détails du suivi du mois ── */
  const { data: categoriesList = [] } = useCategories(core.userId);
  const { data: recurringAll } = useRecurringTransactions(core.userId);
  // Nom de (sous-)catégorie → nom de la catégorie PARENTE (répartition de « Dépensé »).
  const catParentName = useMemo(() => {
    const byId: Record<string, any> = {};
    for (const c of categoriesList as any[]) byId[c.id] = c;
    const map: Record<string, string> = {};
    for (const c of categoriesList as any[]) {
      if (c.name) map[String(c.name).toLowerCase()] = c.parent_id && byId[c.parent_id] ? byId[c.parent_id].name : c.name;
    }
    return map;
  }, [categoriesList]);
  const refCode = (core.profile as any)?.currency_code ?? 'EUR';
  const curByAcc = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of core.accounts as any[]) m[a.id] = a.currency;
    return m;
  }, [core.accounts]);
  /** Montant compté comme DÉPENSÉ, en devise de référence (remboursement = négatif). */
  const spentRef = (t: any) => {
    const amt = -Number(t.amount);
    return convertAmount(amt, curByAcc[t.account_id] || t.account?.currency || refCode, refCode, core.rates) ?? amt;
  };
  const upcoming = useMemo(() => computeMonthUpcoming({
    recurringExpenses: vm.recurUpcoming?.list ?? [],
    txForSuivi: core.txForSuivi as any[],
    accountsForSuivi: core.accountsForSuivi as any[],
    refCode,
    rates: core.rates,
  }), [vm.recurUpcoming, core.txForSuivi, core.accountsForSuivi, refCode, core.rates]);
  /** Ouvrir une opération : sa fiche de modification ; une échéance de crédit → la page Crédits. */
  const openTx = (t: any) => {
    setSheet(null);
    const id = String(t?.id ?? '');
    const target = t?.credit_id || t?.is_credit_flow || id.startsWith('credit')
      ? '/(tabs)/(secondary)/credits'
      : `/(tabs)/transactions/edit/${id}`;
    setTimeout(() => go(target), 60);
  };
  const openUpcoming = (it: UpcomingItem) => openTx(it.tx);

  const accounts = useMemo(() => (core.allAccounts as any[]).filter((a) => !a.is_archived), [core.allAccounts]);
  const mine = accounts.filter((a) => a._role === 'owner' && !a.is_joint);
  const shared = accounts.filter((a) => a.is_joint || a._role !== 'owner');
  const debts = credits.reduce((s, c) => s + Math.max(0, c.remaining), 0);

  const segmented = (
    <GardenSegmented<View3>
      accessibilityLabel="Vues de Mon argent"
      items={[{ key: 'today', label: MONEY_VIEWS.today }, { key: 'month', label: MONEY_VIEWS.month }, { key: 'tomorrow', label: MONEY_VIEWS.tomorrow }]}
      value={view}
      onChange={setView}
    />
  );

  /* DEMAIN : la trésorerie de la Projection telle quelle. Elle défile déjà elle-même : elle prend
     le bas de la page sous un haut fixe, au lieu d'être glissée dans le défilement du Jardin. */
  if (view === 'tomorrow') {
    return <GardenPage title={TABS.money} fill={<ProjectionSection section="treso" />}>{segmented}</GardenPage>;
  }

  if (!core.ready || !p) return <GardenPage title={TABS.money}>{segmented}<GardenWaiting message="Tes comptes arrivent…" /></GardenPage>;

  const total = (p.total_checking ?? 0) + (p.total_savings ?? 0) + (p.total_invested ?? 0);

  /* ── Suivi du mois : les mêmes trois morceaux que « ce qui va encore sortir » du Pilotage ── */
  const spent = Math.max(0, vm.monthExpensesPast ?? 0);
  const variableLeft = Math.max(0, p.variable_envelope_remaining ?? 0);
  const variablePlanned = Math.max(0, p.variable_envelope_planned ?? 0);
  const recurringLeft = Math.max(0, vm.recurUpcoming.amount);
  const leftToSpend = variableLeft + variablePlanned + recurringLeft;
  const monthTotal = spent + leftToSpend;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const monthName = now.toLocaleDateString('fr-FR', { month: 'long' });
  // Lue sur le profil (mis à jour tout de suite, comme Mon parcours) ; repli sur la donnée du Pilotage.
  const margin = Number((core.profile as any)?.safety_margin_amount ?? p.safety_margin_amount ?? 0);
  const setAside = (p.monthly_reserve_planned ?? 0) + (vm.reservationsTotal ?? 0) + (vm.cumulsTotal ?? 0);
  // Teinte de l'estimation : l'eau, adoucie vers la piste (lisible en clair comme en sombre).
  const forecastColor = mixHex(G.water, G.track, 0.5);
  const UPCOMING_INLINE = 5;
  const recurringCount = recurringAll?.length ?? 0;

  return (
    <GardenPage title={TABS.money}>
      {segmented}

      {view === 'today' ? (
        <>
          <GardenCard>
            <GardenText variant="label">Tout ce que tu as</GardenText>
            <GardenText variant="amount" tabular>{eur(total)}</GardenText>
          </GardenCard>
          <GardenGrid cols={2}>
          {GROUPS.map((g) => {
            const list = mine.filter((a) => (g.type === 'other' ? !['checking', 'savings', 'investment'].includes(a.type) : a.type === g.type));
            if (!list.length) return null;
            const groupTotal = g.type === 'checking' ? p.total_checking : g.type === 'savings' ? p.total_savings : g.type === 'investment' ? p.total_invested : null;
            return (
              <GardenRowGroup key={g.type} title={g.title} titleColor={g.color} total={groupTotal != null ? eur(groupTotal) : undefined}
                rows={list.map((a) => ({
                  key: a.id, label: a.name, sub: `${g.typeLabel}${a.is_default ? ' · Principal' : ''}`,
                  value: `${Math.round(Number(a.balance)).toLocaleString('fr-FR')} ${currencySymbolFor(a.currency)}`,
                  icon: GARDEN_ICONS[accountIcon(a.type)].icon, iconColor: g.color, iconBg: g.bg,
                  onPress: () => go(`/(tabs)/comptes/${a.id}`),
                }))} />
            );
          })}
          {shared.length ? (
            <GardenRowGroup title={WORDS.sharedAccounts}
              rows={shared.map((a) => ({
                key: a.id, label: a.name, sub: a.is_joint ? 'compte joint' : 'partagé avec toi',
                value: `${Math.round(Number(a.balance)).toLocaleString('fr-FR')} ${currencySymbolFor(a.currency)}`,
                icon: GARDEN_ICONS.shared.icon, iconColor: GARDEN_ICONS.shared.fg, iconBg: GARDEN_ICONS.shared.bg,
                onPress: () => go(`/(tabs)/comptes/${a.id}`),
              }))} />
          ) : null}
          </GardenGrid>
          {/* Crédits et placements ont LEUR page : un achat immobilier peut compter plusieurs
              crédits, et la projection des placements ne tient pas dans une ligne. */}
          <GardenRowGroup title="Crédits et placements" rows={[
            {
              key: 'credits', label: 'Mes crédits',
              sub: credits.length ? `${credits.length} crédit${credits.length > 1 ? 's' : ''} en cours` : 'aucun crédit en cours',
              value: credits.length ? eur(debts) : undefined,
              icon: GARDEN_ICONS.cabin.icon, iconColor: GARDEN_ICONS.cabin.fg, iconBg: GARDEN_ICONS.cabin.bg,
              onPress: () => go('/(tabs)/(secondary)/credits'),
            },
            {
              key: 'placements', label: 'Mes placements', sub: 'tes fruits, et ce qu’ils peuvent devenir',
              value: (p.total_invested ?? 0) > 0 ? eur(p.total_invested) : undefined,
              icon: GARDEN_ICONS.fruits.icon, iconColor: GARDEN_ICONS.fruits.fg, iconBg: GARDEN_ICONS.fruits.bg,
              onPress: () => go('/(tabs)/(secondary)/placements'),
            },
          ]} />
          <GardenButton label="Ajouter un compte" variant="secondary" onPress={() => go('/(tabs)/comptes/add')} />
          <AdSlot placement="argent" />
        </>
      ) : null}

      {view === 'month' ? (
        <GardenColumns left={<>
          {/* 1 · Où en est le mois : le jour, ce qui est parti, ce qui va encore partir. */}
          <GardenCard>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <GardenText variant="label">Suivi de {monthName}</GardenText>
              <GardenText variant="smallStrong" color={G.inkSoft}>jour {day} sur {daysInMonth}</GardenText>
            </View>
            <GardenBar value={day / daysInMonth} fill={G.primary} track={G.track} accessibilityLabel={`Jour ${day} sur ${daysInMonth}`} />
            {/* Les deux chiffres du mois sont des PORTES : « Dépensé » ouvre le détail de ce qui est
                sorti, « Encore prévu » ce qui est déjà inscrit d'ici la fin du mois. */}
            <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm, marginTop: GARDEN_SPACE.xs }}>
              <MonthTile label={WORDS.spent} value={eur(spent)} color={G.fruitsText} bg={G.fruitsBg} action="Voir le détail"
                onPress={() => setSheet('spent')} accessibilityLabel={`${WORDS.spent} : ${eur(spent)}. Voir le détail des dépenses`} />
              <MonthTile label={WORDS.leftToSpend} value={eur(leftToSpend)} color={G.waterText} bg={G.waterBg} action="Voir ce qui arrive"
                onPress={() => setSheet('upcoming')} accessibilityLabel={`${WORDS.leftToSpend} : ${eur(leftToSpend)}. Voir ce qui arrive d'ici la fin du mois`} />
            </View>
            {/* Barre empilée : la part déjà dépensée et celle qui reste à sortir, sur le total du mois. */}
            {monthTotal > 0 ? (
              <View accessibilityLabel={`${eur(spent)} dépensés, ${eur(leftToSpend)} encore à sortir`}
                style={{ flexDirection: 'row', height: 14, borderRadius: GARDEN_RADII.pill, overflow: 'hidden', backgroundColor: G.track }}>
                <View style={{ flex: spent, backgroundColor: G.fruits }} />
                <View style={{ flex: recurringLeft, backgroundColor: G.water }} />
                <View style={{ flex: variableLeft + variablePlanned, backgroundColor: forecastColor }} />
              </View>
            ) : null}
            <GardenText variant="small" color={G.muted}>Soit environ {eur(monthTotal)} de dépenses sur le mois.</GardenText>
          </GardenCard>

          {/* 2 · D'où vient « Encore prévu » : ce qui est inscrit (prélèvements, saisies) + l'estimation
              du quotidien. Touchée, la carte ouvre ses réglages (base Auto / Estimation / Calculé). */}
          <GardenCard onPress={() => setSheet('left')} accessibilityLabel={`${WORDS.leftToSpend} : ${eur(leftToSpend)}, régler l'estimation`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <GardenText variant="label">{WORDS.leftToSpend}</GardenText>
              <GardenText variant="smallStrong" color={G.primary}>Régler ›</GardenText>
            </View>
            <Part color={G.water} label={WORDS.recurringLeft} hint={vm.recurUpcoming.count ? `${vm.recurUpcoming.count} d'ici la fin du mois : ils sortiront vraiment` : 'plus aucun ce mois-ci'} value={recurringLeft} />
            {variablePlanned > 0 ? <Part color={forecastColor} label="Dépenses déjà saisies" hint="datées des jours à venir" value={variablePlanned} /> : null}
            <Part color={forecastColor} label={WORDS.dailyForecast} hint={`${p.variable_envelope_source === 'history' ? "d'après tes habitudes" : "d'après ton estimation"}, pas une obligation`} value={variableLeft} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: G.line, paddingTop: GARDEN_SPACE.sm }}>
              <GardenText variant="bodyStrong">Total</GardenText>
              <GardenText variant="bodyStrong" tabular color={G.waterText}>{eur(leftToSpend)}</GardenText>
            </View>
          </GardenCard>
        </>} right={<>
          {/* 3 · Ce qui est DÉJÀ INSCRIT d'ici la fin du mois, jour par jour : sorties ET rentrées.
              C'est ici qu'on répond à « qu'est-ce qui va encore tomber ce mois-ci ? ». */}
          <View style={{ gap: GARDEN_SPACE.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: GARDEN_SPACE.sm, paddingHorizontal: 4 }}>
              <GardenText variant="label" style={{ flex: 1 }}>D'ici la fin du mois</GardenText>
              <GardenText variant="smallStrong" tabular color={G.inkSoft}>
                {upcoming.expenseTotal > 0 ? `− ${eur(upcoming.expenseTotal)}` : ''}{upcoming.expenseTotal > 0 && upcoming.incomeTotal > 0 ? '   ' : ''}{upcoming.incomeTotal > 0 ? `+ ${eur(upcoming.incomeTotal)}` : ''}
              </GardenText>
            </View>
            {upcoming.items.length ? (
              <UpcomingRows items={upcoming.items.slice(0, UPCOMING_INLINE)} onOpen={openUpcoming} />
            ) : (
              <GardenRowGroup rows={[{ key: 'none', label: 'Plus rien d’inscrit ce mois-ci', sub: 'ni prélèvement, ni rentrée, ni opération prévue', icon: GARDEN_ICONS.done.icon, iconColor: GARDEN_ICONS.done.fg, iconBg: GARDEN_ICONS.done.bg }]} />
            )}
            {upcoming.items.length > UPCOMING_INLINE ? (
              <GardenButton label={`Tout voir (${upcoming.items.length})`} variant="secondary" onPress={() => setSheet('upcoming')} />
            ) : null}
          </View>

          {/* 4 · Ce qu'on ne touche pas, et la gestion des récurrentes (TOUTES, pas seulement ce
              mois-ci : c'est le catalogue à modifier, pas le suivi du mois). */}
          <GardenRowGroup rows={[
            { key: 'margin', label: WORDS.minimumToKeep, sub: margin > 0 ? "l'eau que tu gardes dans ton arrosoir" : 'aucune marge définie, touche pour en choisir une', value: margin > 0 ? eur(margin) : undefined, icon: GARDEN_ICONS.water.icon, iconColor: GARDEN_ICONS.water.fg, iconBg: GARDEN_ICONS.water.bg, onPress: () => setSheet('margin') },
            { key: 'set', label: WORDS.setAside, sub: 'pour un projet ou plus tard', value: eur(setAside), icon: GARDEN_ICONS.setAside.icon, iconColor: GARDEN_ICONS.setAside.fg, iconBg: GARDEN_ICONS.setAside.bg },
            { key: 'recurring', label: WORDS.recurring, sub: recurringCount ? `${recurringCount} opération${recurringCount > 1 ? 's' : ''} récurrente${recurringCount > 1 ? 's' : ''} · modifier ou arrêter` : 'salaire, loyer, abonnements… à ajouter', icon: GARDEN_ICONS.recurring.icon, iconColor: GARDEN_ICONS.recurring.fg, iconBg: GARDEN_ICONS.recurring.bg, onPress: () => setShowRecurring(true) },
          ]} />
        </>} />
      ) : null}

      {view === 'month' ? <AdSlot placement="argent_mois" /> : null}
      <RecurringTransactionsModal visible={showRecurring} onClose={() => setShowRecurring(false)} userId={core.userId} />
      <SpentSheet visible={sheet === 'spent'} onClose={() => setSheet(null)} spent={vm.suiviDetail?.spent ?? []} monthName={monthName}
        catParentName={catParentName} spentRef={spentRef} onOpenTx={openTx} />
      <UpcomingSheet visible={sheet === 'upcoming'} onClose={() => setSheet(null)} upcoming={upcoming} monthName={monthName} onOpen={openUpcoming} />
      <MarginSheet visible={sheet === 'margin'} onClose={() => setSheet(null)} userId={core.userId} />
      <EstimateSheet visible={sheet === 'estimate'} onClose={() => setSheet(null)} userId={core.userId} />
      <LeftToSpendSheet
        visible={sheet === 'left'}
        onClose={() => setSheet(null)}
        userId={core.userId}
        pilotageData={p}
        pilotageQuery={core.pilotageQuery as any}
        recurringLeft={recurringLeft}
        recurringCount={vm.recurUpcoming.count}
        relykaBefore={vm.relykaAffiche}
        breakdownExtras={{ reservationsTotal: vm.reservationsTotal, preEpargneTotal: vm.preEpargneTotal, preInvestTotal: vm.preInvestTotal }}
        onShowRecurring={() => { setSheet(null); setTimeout(() => setShowRecurring(true), 60); }}
        onEditEstimate={() => { setSheet(null); setTimeout(() => setSheet('estimate'), 60); }}
      />
    </GardenPage>
  );
}
