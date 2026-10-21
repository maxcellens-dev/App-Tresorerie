/**
 * MON ARGENT — deux vues, sans longue page :
 *   - Aujourd'hui : comptes courants (partagés compris, après les miens), fruits (en tête : le total
 *     et le lien vers Mes placements), racines, crédits, autres ;
 *   (le SUIVI DU MOIS — ancien onglet « Ce mois » — vit dans la fiche de l'arrosoir du Jardin,
 *    cf. components/garden/MonthPanel ; un lien ?view=month y renvoie) ;
 *   - Demain : la trésorerie de la Projection, directement (pas de bouton pour y aller).
 *
 * Plus de page « Opérations » dans ce modèle : les opérations se consultent depuis chaque compte.
 * Les chiffres sont ceux du Pilotage (même cœur de données), jamais recalculés ici.
 */
import { live } from '../../lib/garden/live';
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Pico from '../../components/garden/Pico';
import { pointer } from '../../lib/ui/webLayout';
import GardenPage, { GardenGrid, GardenWaiting } from '../../components/garden/GardenPage';
import GardenText from '../../components/garden/GardenText';
import GardenCard from '../../components/garden/GardenCard';
import GardenButton from '../../components/garden/GardenButton';
import GardenSegmented from '../../components/garden/GardenSegmented';
import { GardenRowGroup } from '../../components/garden/GardenList';
import AdSlot from '../../components/marketing/AdSlot';
import { ProjectionSection } from '../../components/money/ProjectionSection';
import { useGardenModel } from '../../hooks/garden/useGardenModel';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../lib/finance/currency';
import { GARDEN_ICONS, accountIcon } from '../../lib/garden/icons';
import { effectiveSharedMode } from '../../lib/finance/perimeter';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE, mixHex } from '../../lib/garden/theme';
import { MONEY_VIEWS, TABS, TREE_PARTS } from '../../lib/garden/lexicon';

type View2 = 'today' | 'tomorrow';
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

/* Un groupe par type de compte. Chaque compte prend l'icône ET la couleur de SA partie de l'arbre
   (lib/garden/icons) : courant = arrosoir, épargne = racines, placements = fruits — les mêmes que
   dans la scène et sur les gestes de Pépin. */
const GROUPS: { type: string; title: string; meaning: string; color: string; bg: string; typeLabel: string }[] = live(() => ([
  { type: 'checking', title: TREE_PARTS.can.name, meaning: TREE_PARTS.can.meaning, color: GARDEN_ICONS.water.fg, bg: GARDEN_ICONS.water.bg, typeLabel: 'Courant' },
  { type: 'investment', title: TREE_PARTS.branches.name, meaning: TREE_PARTS.branches.meaning, color: GARDEN_ICONS.fruits.fg, bg: GARDEN_ICONS.fruits.bg, typeLabel: 'Investissement' },
  { type: 'savings', title: TREE_PARTS.roots.name, meaning: TREE_PARTS.roots.meaning, color: GARDEN_ICONS.roots.fg, bg: GARDEN_ICONS.roots.bg, typeLabel: 'Épargne' },
  { type: 'other', title: 'Autres comptes', meaning: '', color: GARDEN_ICONS.otherAccount.fg, bg: GARDEN_ICONS.otherAccount.bg, typeLabel: 'Autre' },
]));

export default function ArgentScreen() {
  const router = useRouter();
  const { core, credits } = useGardenModel();
  const { pilotageData: p } = core;
  const params = useLocalSearchParams<{ view?: string; t?: string }>();
  const asView = (v?: string): View2 | null => (v === 'today' || v === 'tomorrow' ? v : null);
  const [view, setView] = useState<View2>(() => asView(params.view) ?? 'today');
  /* L'onglet reste monté : chaque lien doit quand même basculer la vue — le bouton « Mon argent »
     du menu rouvre toujours « Aujourd'hui ». `t` change à
     chaque appui : sans lui, revenir avec le même `view` qu'avant ne déclenchait rien. */
  useEffect(() => { const v = asView(params.view); if (v) setView(v); }, [params.view, params.t]);
  // ancien lien vers l'onglet « Ce mois » → la fiche de l'arrosoir, qui porte désormais le mois
  useEffect(() => { if (params.view === 'month') router.replace(`/(tabs)/jardin?open=can&t=${Date.now()}` as any); }, [params.view, params.t]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (r: string) => router.push(r as any);

  const accounts = useMemo(() => (core.allAccounts as any[]).filter((a) => !a.is_archived), [core.allAccounts]);
  const mine = accounts.filter((a) => a._role === 'owner' && !a.is_joint);
  const shared = accounts.filter((a) => a.is_joint || a._role !== 'owner');
  const debts = credits.reduce((s, c) => s + Math.max(0, c.remaining), 0);

  /* Les deux vues, et à droite l'accès à TOUTES les opérations (liste, recherche, filtres). */
  const segmented = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1 }}>
        <GardenSegmented<View2>
          accessibilityLabel="Vues de Mon argent"
          items={[{ key: 'today', label: MONEY_VIEWS.today }, { key: 'tomorrow', label: MONEY_VIEWS.tomorrow }]}
          value={view}
          onChange={setView}
        />
      </View>
      <Pressable onPress={() => go('/(tabs)/transactions')} accessibilityRole="button" accessibilityLabel="Toutes mes opérations"
        style={({ pressed, hovered }: any) => [{ width: 52, height: 52, borderRadius: GARDEN_RADII.md, alignItems: 'center', justifyContent: 'center', gap: 1, backgroundColor: pressed || hovered ? G.field : G.track }, pointer]}>
        <Ionicons name="receipt-outline" size={20} color={G.primary} />
        <GardenText variant="small" color={G.primary} style={{ fontSize: 10, lineHeight: 12 }}>Opérations</GardenText>
      </Pressable>
    </View>
  );

  /* DEMAIN : la trésorerie de la Projection telle quelle. Elle défile déjà elle-même : elle prend
     le bas de la page sous un haut fixe, au lieu d'être glissée dans le défilement du Jardin. */
  if (view === 'tomorrow') {
    return <GardenPage calculator="argent" title={TABS.money} fill={<ProjectionSection section="treso" />}>{segmented}</GardenPage>;
  }

  if (!core.ready || !p) return <GardenPage title={TABS.money}>{segmented}<GardenWaiting message="Tes comptes arrivent…" /></GardenPage>;

  const total = (p.total_checking ?? 0) + (p.total_savings ?? 0) + (p.total_invested ?? 0);

  return (
    <GardenPage calculator="argent" title={TABS.money}>
      {segmented}

      {view === 'today' ? (
        <>
          <GardenCard style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <GardenText variant="label">Tout ce que tu as</GardenText>
              <GardenText variant="amount" tabular>{eur(total)}</GardenText>
            </View>
            <Pico size={84} mood="joy" />
          </GardenCard>
          {/* Ordre : arrosoir (courants), fruits (placements), racines (épargne), crédits, autres.
              Les comptes PARTAGÉS sont rangés avec ceux de leur type, toujours après les miens,
              reconnaissables à leur icône et à leur libellé en italique. */}
          <GardenGrid cols={2}>
          {GROUPS.map((g) => {
            const ofType = (a: any) => (g.type === 'other' ? !['checking', 'savings', 'investment'].includes(a.type) : a.type === g.type);
            const own = mine.filter(ofType), others = shared.filter(ofType);
            /* Compte partagé : une joint « contribution » (ou réglé à 0 % pour moi) n'entre PAS dans mes
               totaux — montant en retrait et « hors de ton total » ; sinon seule MA PART y entre. */
            const sharedNote = (a: any) => {
              const pct = a._impact_pct ?? 100;
              if (effectiveSharedMode(a.shared_mode) === 'contribution' || pct === 0) return { note: ' · hors de ton total', outside: true };
              return { note: pct < 100 ? ` · ta part : ${Math.round(pct)} %` : '', outside: false };
            };
            const accountRow = (a: any, isShared: boolean) => ({
              key: a.id, label: a.name, italic: isShared, valueMuted: isShared && sharedNote(a).outside,
              sub: isShared ? `${a.is_joint ? 'compte joint' : 'partagé avec toi'}${sharedNote(a).note}` : `${g.typeLabel}${a.is_default ? ' · Principal' : ''}`,
              value: `${Math.round(Number(a.balance)).toLocaleString('fr-FR')} ${currencySymbolFor(a.currency)}`,
              icon: isShared ? GARDEN_ICONS.shared.icon : GARDEN_ICONS[accountIcon(a.type)].icon,
              iconColor: isShared ? GARDEN_ICONS.shared.fg : g.color, iconBg: isShared ? GARDEN_ICONS.shared.bg : g.bg,
              onPress: () => go(`/(tabs)/comptes/${a.id}`),
            });
            const rows = [...own.map((a) => accountRow(a, false)), ...others.map((a) => accountRow(a, true))];
            if (g.type === 'investment') {
              /* Fruits : une ligne de total en tête, qui mène à « Mes placements » (la projection des
                 placements ne tient pas dans une ligne). Toujours là, même sans placement. */
              return (
                <GardenRowGroup key={g.type} title={g.title} titleColor={g.color} rows={[{
                  key: 'placements', label: 'Mes placements', sub: rows.length ? 'le fruit de tes placements' : 'aucun placement pour l’instant',
                  value: eur(p.total_invested ?? 0),
                  // ligne de TOTAL : sans icône, fond teinté des fruits — elle ne ressemble pas à un compte
                  bg: mixHex(GARDEN_ICONS.fruits.bg, G.card, 0.7),
                  onPress: () => go('/(tabs)/(secondary)/placements'),
                }, ...rows]} />
              );
            }
            if (!rows.length) return null;
            const groupTotal = g.type === 'checking' ? p.total_checking : g.type === 'savings' ? p.total_savings : null;
            return <GardenRowGroup key={g.type} title={g.title} titleColor={g.color} total={groupTotal != null ? eur(groupTotal) : undefined} rows={rows} />;
          }).flatMap((node, i) => (i === 2 ? [node, (
            /* Crédits (la cabane) : après les racines. Un achat immobilier peut compter plusieurs
               crédits → ils ont leur page. */
            <GardenRowGroup key="credits" title={TREE_PARTS.cabin.name} titleColor={GARDEN_ICONS.cabin.fg} total={credits.length ? eur(debts) : undefined} rows={[{
              key: 'credits', label: 'Mes crédits',
              sub: credits.length ? `${credits.length} crédit${credits.length > 1 ? 's' : ''} en cours` : 'aucun crédit en cours',
              icon: GARDEN_ICONS.cabin.icon, iconColor: GARDEN_ICONS.cabin.fg, iconBg: GARDEN_ICONS.cabin.bg,
              onPress: () => go('/(tabs)/(secondary)/credits'),
            }]} />
          )] : [node]))}
          </GardenGrid>
          <GardenButton label="Ajouter un compte" variant="secondary" onPress={() => go('/(tabs)/comptes/add')} />
          <AdSlot placement="argent" />
        </>
      ) : null}

    </GardenPage>
  );
}
