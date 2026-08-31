/**
 * LA VUE BUDGETS — sous-onglet de l'onglet « Budget ».
 *
 * Elle répond à UNE question : « combien puis-je encore dépenser ? ». Tout le reste — l'année, les
 * mois passés — est une SECONDE question, et une seconde question n'a pas à occuper la même page.
 * D'où deux onglets (Catégories / Historique) et une bascule mois ↔ année, plutôt qu'une longue
 * page où l'on faisait défiler trois sujets à la suite.
 *
 * Il n'y a PAS de budget global (migration 218) : « 1 200 € au total » ne dit rien d'actionnable au
 * moment de faire ses courses, et l'enveloppe variable répond déjà mieux à cette question — elle
 * est calculée sur les dépenses réelles au lieu d'être devinée. Le bandeau du haut est donc un
 * CUMUL de ce que l'utilisateur a décidé, pas une limite qu'il aurait posée.
 *
 * Ce qu'elle n'affiche JAMAIS :
 *  • un budget qu'on n'a pas fixé (une catégorie sans budget est une ligne grise, sans jauge) ;
 *  • un dépassement en rouge (l'ambre du variable, cf. `BudgetGauge`) ;
 *  • un chiffre hérité sans le dire (« repris d'août » est toujours écrit).
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { contrastRatio, darken, lighten, readableOn } from '../../theme/palette';
import { useAuth } from '../../contexts/AuthContext';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { addMonthKey, monthLabel } from '../../lib/finance/monthKeys';
import { todayISO } from '../../lib/dateUtils';
import { useBudgetData } from '../../hooks/data/useBudgetData';
import {
  buildBudgetHistory, countMonthsRespected, monthKeyOf, periodLabel, yearKeyOf,
  type BudgetLine,
} from '../../lib/finance/budgetEngine';
import AppButton from '../ui/AppButton';
import PageTabs from '../ui/PageTabs';
import SegmentedControl from '../ui/SegmentedControl';
import CategoryDonut from '../charts/CategoryDonut';
import { iconForCategory } from '../../lib/ui/categoryIcons';
import { useAlignedTabsTop } from '../../lib/ui/tabsAlign';
import BudgetGauge, { BudgetAmounts } from './BudgetGauge';

type Tab = 'categories' | 'history';
/** Fenêtre de lecture : le mois affiché, ou l'année en cours. */
type Scope = 'month' | 'year';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export default function BudgetsView({ aboveOffset = 0 }: {
  /**
   * Hauteur de ce que la PAGE pose au-dessus de cette vue (le segment « Budgets / Projets »).
   * Cette vue ne peut pas le mesurer elle-même, et l'oublier fausserait l'alignement des onglets :
   * le module croirait le bloc du dessus bien plus court qu'il ne l'est et compenserait en trop.
   */
  aboveOffset?: number;
}) {
  const C = useAppColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const { user } = useAuth();

  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [tab, setTab] = useState<Tab>('categories');
  const [scope, setScope] = useState<Scope>('month');
  /** Ligne mise en lumière dans l'anneau — `null` = vue d'ensemble. */
  const [selected, setSelected] = useState<string | null>(null);
  const yearKey = yearKeyOf(monthKey);
  const atCurrent = monthKey === currentMonth;

  /* La mise en lumière désigne une ligne DE CETTE liste-ci. En changeant de période ou de cadence,
     on change de liste : garder la sélection laissait une ligne surlignée qui ne correspondait plus
     à aucune tranche de l'anneau — ou, pire, à la tranche d'une autre catégorie. */
  useEffect(() => { setSelected(null); }, [monthKey, scope]);

  const { result, budgets, categories, fluxTx, accountTypeById, isReady, isError } = useBudgetData(user?.id, monthKey);

  const history = useMemo(
    () => buildBudgetHistory(
      Array.from({ length: 6 }, (_, i) => addMonthKey(monthKey, i - 5)),
      fluxTx, accountTypeById, budgets ?? [], today, categories,
    ),
    [monthKey, fluxTx, accountTypeById, budgets, today, categories],
  );
  const respected = useMemo(() => countMonthsRespected(history), [history]);

  /* Cumul ANNUEL : la somme des lignes annuelles. Il n'a rien à voir avec le cumul mensuel et ne
     s'additionne jamais avec lui — deux fenêtres, jamais une division (cf. budgetEngine). */
  const annualTotal = useMemo(() => {
    const budget = result.annual.reduce((sum, r) => sum + r.budget, 0);
    const spent = result.annual.reduce((sum, r) => sum + r.spent, 0);
    return { budget, spent, remaining: budget - spent };
  }, [result.annual]);

  /* L'ANNEAU : une tranche par catégorie budgétée, plus une tranche NEUTRE pour ce qui reste à
     dépenser. Sans elle, un anneau plein se lirait « budget épuisé » alors qu'il resterait la
     moitié — un camembert de répartition et une jauge de consommation ne disent pas la même chose,
     et ici on veut les deux.
     ⚠️ `colorByCategory` est ce qui donne un SENS aux couleurs : la liste juste en dessous colore
     l'icône de chaque ligne de la même teinte, et devient donc la légende de l'anneau. Sans ce
     lien, les tranches n'étaient que du décor — six couleurs sans savoir laquelle était quoi.
     La palette est celle, À L'IDENTIQUE ET DANS LE MÊME ORDRE, du camembert « Dépensé ce mois »
     (`SpentDetail`) : deux anneaux de catégories dans la même app doivent teinter Alimentation de
     la même façon, sinon la couleur cesse d'être un repère. */
  const { donut, colorByCategory } = useMemo(() => {
    const yearMode = scope === 'year' && result.annual.length > 0;
    const lines = yearMode ? result.annual : result.rows;
    const budget = yearMode ? annualTotal.budget : result.total.budget;
    const spent = yearMode ? annualTotal.spent : result.total.spent;
    const palette = [C.danger, C.orange, C.violet, C.blue, C.green, C.teal, C.yellow, C.emerald, C.checking];
    const colors = new Map<string, string>();
    lines.forEach((l, i) => colors.set(l.categoryId, palette[i % palette.length]));
    const segments = lines
      .filter((l) => l.spent > 0)
      .map((l) => ({ key: l.categoryId, value: l.spent, color: colors.get(l.categoryId)! }));
    /* Le reste se calcule sur ce que les TRANCHES totalisent, pas sur le dépensé cumulé. Les deux
       diffèrent quand une catégorie est en négatif (remboursements supérieurs aux dépenses) : elle
       est écartée des tranches mais compte dans le cumul, et l'anneau dépassait alors le tour. */
    const shown = segments.reduce((sum, seg) => sum + seg.value, 0);
    const left = Math.max(0, budget - shown);
    if (left > 0) segments.push({ key: '__left', value: left, color: C.cardBorder });
    /* Une ligne SÉLECTIONNÉE prend le centre de l'anneau : on y lit alors SON taux de consommation
       à elle (270 € sur 200 € = 130 %), pas celui de l'ensemble. Même geste que le camembert
       « Dépensé ce mois », où toucher une part recentre le total dessus. */
    const sel = selected ? lines.find((l) => l.categoryId === selected) : null;
    const shownSpent = sel ? sel.spent : spent;
    const shownBudget = sel ? sel.budget : budget;
    const pct = shownBudget > 0 ? Math.round((shownSpent / shownBudget) * 100) : 0;
    return {
      colorByCategory: colors,
      donut: {
        segments,
        activeKey: sel ? sel.categoryId : null,
        centerLabel: shownBudget > 0 ? `${pct} %` : '—',
        centerSub: sel ? sel.name : (budget > 0 ? 'consommé' : 'sans budget'),
        over: shownBudget > 0 && shownSpent > shownBudget,
      },
    };
  }, [scope, result.rows, result.annual, result.total, annualTotal, selected, C]);

  /* Alignement des onglets avec ceux de la page Comptes : on MESURE tout ce qui les précède et on
     complète jusqu'au plus haut des deux écrans (cf. lib/ui/tabsAlign). Aucune marge codée en dur —
     le bloc du dessus change de hauteur selon les données, des deux côtés.
     Ce qui précède ces onglets, c'est le segment de la page (`aboveOffset`) PLUS le sélecteur de
     période ci-dessous : les deux, sinon le compte est faux. */
  const [monthRowBottom, setMonthRowBottom] = useState<number | null>(null);
  const tabsTopPad = useAlignedTabsTop(
    'budget',
    monthRowBottom == null ? null : aboveOffset + monthRowBottom,
  );

  /* Couleurs de la tuile d'action, reprises À L'IDENTIQUE de la fiche compte : un rond d'encre
     dégradé (on éclaircit le haut d'un rond noir, on assombrit le bas d'un rond blanc — la lumière
     vient toujours d'en haut) et une icône en négatif. Encre et fond étant réglables en
     administration, on retombe sur un noir/blanc garanti si le couple choisi ne contraste pas. */
  const actionInk = C.text;
  const actionGradient: [string, string] = C.mode === 'light'
    ? [lighten(actionInk, 0.24), actionInk]
    : [actionInk, darken(actionInk, 0.16)];
  const actionIconColor = contrastRatio(C.bg, actionInk) >= 4.5 ? C.bg : readableOn(actionInk);

  const edit = () => router.push(`/(tabs)/projects/budget-edit?month=${monthKey}` as any);
  /* La bascule reste offerte dès que le profil porte UN budget annuel, même si l'année affichée n'en
     a pas encore. Adossée aux seules lignes de l'année en cours, elle disparaissait en reculant
     d'un an : la page repassait d'elle-même en mensuel, les flèches reprenaient un pas d'un mois, et
     l'on se retrouvait douze mois en arrière sans avoir rien demandé. */
  // La catégorie doit encore EXISTER : sinon la bascule menait à une vue annuelle vide (« 0 / 0 € »).
  const canShowYear = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    return (budgets ?? []).some((b) => b.period === 'year' && b.amount > 0 && known.has(b.category_id));
  }, [budgets, categories]);
  const showYear = scope === 'year' && canShowYear;

  /* ── CHARGEMENT ───────────────────────────────────────────────────────────
     Tant que les lectures n'ont pas TOUTES abouti, le calcul porte sur des tableaux vides et rendrait
     « 0 / 0 € · aucune catégorie budgétée » — c'est-à-dire l'écran de quelqu'un qui n'a pas de
     budget, montré à quelqu'un qui en a. Sur un réseau lent, ce faux état vide dure ; si une lecture
     échoue, il ne s'en va jamais. On ne montre donc aucun chiffre avant de les avoir tous. */
  if (isError) {
    return (
      <View style={s.loading}>
        <Ionicons name="cloud-offline-outline" size={28} color={C.textSecondary} />
        <Text style={[s.emptyText, { marginTop: 12 }]}>
          Tes budgets n’ont pas pu être chargés. Vérifie ta connexion et reviens sur cette page.
        </Text>
      </View>
    );
  }
  if (!isReady) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  /* ── ÉTAT VIDE ────────────────────────────────────────────────────────────
     Un écran qui explique ce qu'il ferait s'il était rempli, et un seul bouton. */
  if (result.isEmpty) {
    return (
      <ScrollView contentContainerStyle={s.emptyWrap} showsVerticalScrollIndicator={false}>
        <View style={s.emptyIcon}><Ionicons name="pie-chart-outline" size={30} color={C.primary} /></View>
        <Text style={s.emptyTitle}>Fixe-toi un budget</Text>
        <Text style={s.emptyText}>
          Relyka sait déjà ce que tu dépenses d'habitude. Un budget, c'est ce que tu décides de
          t'autoriser — et Relyka suit l'écart pour toi, sans que tu aies à saisir quoi que ce soit
          en double.
        </Text>
        <AppButton label="Créer un budget" size="lg" onPress={edit} style={{ marginTop: 20, alignSelf: 'stretch' }} />
        <TouchableOpacity style={s.catLink} onPress={() => router.push('/(tabs)/(secondary)/categories' as any)} accessibilityRole="button">
          <Text style={s.catLinkText}>Gérer mes catégories</Text>
          <Ionicons name="chevron-forward" size={14} color={C.primary} />
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const t = result.total;

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {/* Période — le libellé est un BOUTON qui ramène au mois en cours, comme sur la page
          Transactions. Sans ça, on s'éloigne de trois mois et il faut trois retours pour revenir.
          C'est aussi TOUT ce que cet écran place au-dessus de ses onglets : c'est donc ce bloc
          qu'on mesure pour les aligner sur ceux de la page Comptes. */}
      {/* Le `onLayout` est sur un CONTENEUR, pas sur la barre elle-même : la hauteur mesurée d'un
          élément n'inclut PAS sa propre marge basse, et on aurait donc sous-estimé de 10 px ce qui
          précède les onglets — assez pour les décaler. Un conteneur, lui, absorbe la marge de son
          enfant dans sa hauteur. */}
      <View onLayout={(e) => setMonthRowBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={s.monthRow}>
        <TouchableOpacity onPress={() => setMonthKey(addMonthKey(monthKey, showYear ? -12 : -1))} accessibilityRole="button" accessibilityLabel="Période précédente" hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.monthLabelWrap}
          onPress={() => setMonthKey(currentMonth)}
          disabled={atCurrent}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={atCurrent ? undefined : 'Revenir au mois en cours'}
        >
          <Text style={s.monthLabel}>{showYear ? yearKey : monthLabel(monthKey)}</Text>
          {!atCurrent && <Text style={s.monthHint}>Appuyer pour revenir</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMonthKey(addMonthKey(monthKey, showYear ? 12 : 1))} accessibilityRole="button" accessibilityLabel="Période suivante" hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={C.textSecondary} />
        </TouchableOpacity>

      </View>

      {/* CADENCE + ACTION — logée dans l'espace qui séparait déjà la période des onglets, pour ne
          rien pousser vers le bas. Elle est DANS le bloc mesuré : ce qu'elle occupe est retranché
          du complément d'alignement, les onglets ne bougent donc pas.
          ⚠️ La rangée est rendue dans les DEUX onglets et le bouton y prend toute la place restante.
          C'est ce qui permet à la bascule mois/an de disparaître sur « Historique » — où elle
          n'aurait aucun sens — sans changer la hauteur de la rangée : seule la largeur du bouton
          varie. Une rangée qui change de hauteur ferait sauter les onglets à chaque bascule. */}
      <View style={s.actionRow}>
        {/* TUILE D'ACTION, pas un bouton de formulaire — le langage EXACT des actions de la fiche
            compte (« Dépense », « Recette », « Nouveau solde ») : aucun fond ni contour, juste un
            rond d'ENCRE (noir en thème clair, blanc en sombre) portant l'icône en négatif, puis le
            libellé. Posée à l'horizontale plutôt qu'en colonne, pour tenir dans la hauteur de cette
            rangée sans rien décaler. Elle se distingue ainsi des boutons « Enregistrer / Annuler »,
            qui concluent une saisie — ici, on ouvre un écran. */}
        <TouchableOpacity
          style={s.editTile}
          onPress={edit}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Modifier mes budgets"
        >
          <LinearGradient
            colors={actionGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.editTileIcon}
          >
            <Ionicons name="create-outline" size={14} color={actionIconColor} />
          </LinearGradient>
          <Text style={s.editTileLabel} numberOfLines={1}>Modifier budgets</Text>
        </TouchableOpacity>

      </View>
      </View>

      {/* Des onglets de PAGE (soulignés), pas un segment encadré : ici on navigue entre deux
          contenus, on ne choisit pas un réglage. Même style — et même HAUTEUR — que
          « Comptes / Crédits » : voir `useAlignedTabsTop` plus haut. */}
      {/* Le complément d'alignement est porté par un CONTENEUR, pas par `style` : les marges des
          onglets appartiennent au composant, et un `marginTop` passé en prop les écraserait. */}
      <View style={{ paddingTop: tabsTopPad }}>
        <PageTabs
          options={[{ value: 'categories', label: 'Catégories' }, { value: 'history', label: 'Historique' }]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          /* La bascule mois/an vit SUR la barre d'onglets, à droite : elle cadre ce que l'onglet
             montre, elle n'a donc pas à occuper une ligne à elle. Format `sm` obligatoire — au
             format normal, elle ferait grandir la barre et descendre les libellés. */
          right={canShowYear && tab === 'categories' ? (
            <SegmentedControl
              options={[{ value: 'month', label: 'mois' }, { value: 'year', label: 'an' }]}
              value={showYear ? 'year' : 'month'}
              onChange={(v) => setScope(v as Scope)}
              role="radio"
              size="sm"
            />
          ) : undefined}
        />
      </View>

      {tab === 'categories' ? (
        <>

          {/* Cumul — la somme de ce qui a été DÉCIDÉ, en face du dépensé correspondant.
              L'ANNEAU répond d'un coup d'œil à « où j'en suis », que les chiffres ne donnent
              qu'après lecture ; les tranches disent en même temps D'OÙ vient la consommation. Il
              reprend les couleurs et la logique du camembert « Dépensé ce mois » — même geste,
              même image. */}
          <View style={s.card}>
            <Text style={s.kicker}>{showYear ? `Sur tes budgets annuels · ${yearKey}` : 'Sur tes budgets du mois'}</Text>

            <View style={s.heroRow}>
              <CategoryDonut
                segments={donut.segments}
                size={104}
                strokeWidth={14}
                activeKey={donut.activeKey}
                centerLabel={donut.centerLabel}
                centerSub={donut.centerSub}
                centerColor={donut.over ? C.warning : C.text}
                centerSubColor={C.textSecondary}
              />
              {/* TOUT le texte tient à droite de l'anneau — montant, jauge et commentaires. En le
                  laissant descendre SOUS l'anneau, la carte gagnait trois lignes de hauteur pour
                  une colonne de gauche qui restait vide. Les montants sont alignés à DROITE :
                  c'est ainsi qu'ils s'empilent avec la jauge qui les mesure. */}
              <View style={s.heroText}>
                <Text style={s.big}>
                  {fmt(showYear ? annualTotal.spent : t.spent)}
                  <Text style={s.bigSub}> / {fmt(showYear ? annualTotal.budget : t.budget)} {CURRENCY_SYMBOL}</Text>
                </Text>
                <BudgetGauge
                  spent={showYear ? annualTotal.spent : t.spent}
                  budget={showYear ? annualTotal.budget : t.budget}
                />
                {/* Des phrases COURTES, une par fait. Elles étaient rédigées (« à ce rythme, 533 €
                    en fin de mois », « tous postes confondus ») : à côté d'un chiffre de 24 px,
                    personne ne lit une phrase — on lit le montant et le mot qui le qualifie. */}
                <Text style={s.heroSub}>
                  {(showYear ? annualTotal.remaining : t.remaining) >= 0
                    ? `${fmt(showYear ? annualTotal.remaining : t.remaining)} ${CURRENCY_SYMBOL} restants`
                    : `Dépassé de ${fmt(-(showYear ? annualTotal.remaining : t.remaining))} ${CURRENCY_SYMBOL}`}
                </Text>
                {/* Une PROJECTION n'a de sens que sur un mois en cours. Sur un mois révolu, la
                    phrase annonçait « prévus fin de mois » pour un mois terminé — et le chiffre
                    valait exactement le dépensé affiché juste au-dessus. */}
                {!showYear && atCurrent && result.pace != null && t.budget > 0 && (
                  <Text style={s.heroSub}>{fmt((result.pace / 100) * t.budget)} {CURRENCY_SYMBOL} prévus fin de mois</Text>
                )}
                {/* Le dépensé TOTAL situe le cumul : sans lui, on croirait que 533 € est tout ce
                    qui est sorti, alors que seules les catégories budgétées sont comptées ici. */}
                {!showYear && (
                  <Text style={s.heroSub}>{fmt(t.spentAll)} {CURRENCY_SYMBOL} dépensés en tout</Text>
                )}
                {!showYear && result.plannedRest > 0 && (
                  <Text style={s.heroSub}>+ {fmt(result.plannedRest)} {CURRENCY_SYMBOL} déjà saisis</Text>
                )}
                {/* LA RÉGULARISATION DE SOLDE, ISOLÉE. Elle compte dans le dépensé — constater qu'il
                    manque 80 € sur le compte, c'est 80 € partis — mais elle n'a pas été CHOISIE. La
                    confondre avec des courses fausserait le jugement qu'on porte sur son propre
                    mois : on se croit dépensier alors qu'on a surtout un écart de saisie. */}
                {!showYear && result.regulPart > 0 && (
                  <Text style={s.heroSub}>dont {fmt(result.regulPart)} {CURRENCY_SYMBOL} de régularisation</Text>
                )}
              </View>
            </View>
          </View>

          <View style={s.card}>
            {(showYear ? result.annual : result.rows).length === 0 ? (
              <Text style={s.sub}>
                {showYear ? 'Aucun budget annuel.' : 'Aucune catégorie budgétée ce mois-ci.'}
              </Text>
            ) : (
              (showYear ? result.annual : result.rows).map((r, i) => (
                <Row
                  key={r.categoryId}
                  line={r}
                  first={i === 0}
                  styles={s}
                  yearly={showYear}
                  dotColor={colorByCategory.get(r.categoryId)}
                  selectedId={selected}
                  onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
                />
              ))
            )}
            {!showYear && result.outside > 0 && (
              <View style={[s.row, result.rows.length > 0 && { marginTop: 16 }]}>
                <View style={s.rowHead}>
                  <Text style={[s.rowName, { color: C.textSecondary }]} numberOfLines={1}>Autres dépenses</Text>
                  <Text style={s.rowAmounts}>{fmt(result.outside)} {CURRENCY_SYMBOL}</Text>
                </View>
                <Text style={s.rowNote}>Sans budget fixé</Text>
              </View>
            )}
          </View>

        </>
      ) : (
        <View style={s.card}>
          {history.filter((h) => h.hasBudget).length === 0 ? (
            <Text style={s.sub}>Pas encore de mois budgété à comparer. Reviens le mois prochain.</Text>
          ) : (
            <>
              {history.filter((h) => h.hasBudget).map((h, i) => (
                <View key={h.monthKey} style={[s.row, i > 0 && { marginTop: 14 }]}>
                  <View style={s.rowHead}>
                    <Text style={s.rowName} numberOfLines={1}>{h.label}</Text>
                    <BudgetAmounts spent={h.spent} budget={h.budget} symbol={CURRENCY_SYMBOL} />
                  </View>
                  <BudgetGauge spent={h.spent} budget={h.budget} compact />
                  {/* UN MOIS EN COURS NE SE JUGE PAS. Le 3 du mois, 40 € face à 1 000 € n'est pas
                      un budget « tenu » : c'est un mois qui commence. Écrire « tenu · 960 € sous le
                      budget » revenait à féliciter par avance, et le verdict s'inversait ensuite
                      sous les yeux de l'utilisateur. On dit donc simplement où l'on en est. */}
                  <Text style={[s.rowNote, h.inProgress ? null : { color: (h.gap ?? 0) >= 0 ? C.success : C.warning }]}>
                    {h.inProgress
                      ? ((h.gap ?? 0) >= 0
                        ? `En cours · ${fmt(h.gap ?? 0)} ${CURRENCY_SYMBOL} restants`
                        : `En cours · dépassé de ${fmt(-(h.gap ?? 0))} ${CURRENCY_SYMBOL}`)
                      : ((h.gap ?? 0) >= 0
                        ? `Tenu · ${fmt(h.gap ?? 0)} ${CURRENCY_SYMBOL} sous le budget`
                        : `Dépassé de ${fmt(-(h.gap ?? 0))} ${CURRENCY_SYMBOL}`)}
                  </Text>
                </View>
              ))}
              {/* Le bilan ne porte que sur les mois TERMINÉS (cf. countMonthsRespected). */}
              {respected.total > 0 && (
                <Text style={[s.sub, { marginTop: 14 }]}>
                  Budget tenu {respected.respected} mois sur {respected.total}
                  {respected.total === 1 ? ' terminé.' : ' terminés.'}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Le budget ne vaut que ce que vaut le découpage en catégories — le raccourci a sa place ici,
          et pas enterré dans les Paramètres. */}
      <TouchableOpacity style={s.catLink} onPress={() => router.push('/(tabs)/(secondary)/categories' as any)} accessibilityRole="button">
        <Text style={s.catLinkText}>Gérer mes catégories</Text>
        <Ionicons name="chevron-forward" size={14} color={C.primary} />
      </TouchableOpacity>
    </ScrollView>
  );
}

/**
 * Une ligne de catégorie budgétée, avec ses sous-catégories budgétées en retrait.
 *
 * PARENTE et SOUS-CATÉGORIE ne se lisent pas pareil, et c'est nécessaire : le montant d'une
 * parente CONTIENT celui de ses enfants. Les rendre identiques donnait une liste plate où l'on
 * additionnait mentalement des lignes qui ne s'additionnent pas. La parente porte donc le poids
 * d'un titre (14 px, gras, encre pleine), l'enfant celui d'un détail (12,5 px, encre secondaire),
 * en retrait derrière un rail et précédé d'une flèche de descendance.
 */
function Row({ line, first, styles: s, yearly, depth = 0, dotColor, selectedId, onSelect }: {
  line: BudgetLine; first: boolean; styles: any; yearly?: boolean; depth?: number;
  /** Couleur de la tranche correspondante dans l'anneau — c'est ce qui en fait la légende. */
  dotColor?: string;
  selectedId?: string | null;
  /** Met la ligne en lumière dans l'anneau. Seules les lignes de PREMIER niveau y ont une tranche. */
  onSelect?: (id: string) => void;
}) {
  const C = useAppColors();
  const over = line.remaining < 0;
  const child = depth > 0;
  const on = selectedId === line.categoryId;
  return (
    <>
      <TouchableOpacity
        style={[s.row, !first && (child ? s.rowChildGap : s.rowGap), child && s.rowChild, on && s.rowOn]}
        activeOpacity={onSelect && !child ? 0.7 : 1}
        disabled={!onSelect || child}
        onPress={() => onSelect?.(line.categoryId)}
        accessibilityRole={onSelect && !child ? 'button' : undefined}
        accessibilityState={onSelect && !child ? { selected: on } : undefined}
      >
        <View style={s.rowHead}>
          {/* L'ICÔNE de la catégorie, la même que dans la liste des transactions et le camembert
              « Dépensé ce mois » — pas une pastille de couleur. On reconnaît « Courses » à son
              caddie, pas à un rond orange ; et la teinte, elle, reste celle de la tranche
              correspondante de l'anneau, ce qui fait de la liste sa légende.
              Une sous-catégorie garde l'icône mais l'encre secondaire : elle est un détail de sa
              parente, pas une tranche de l'anneau. */}
          <Ionicons
            name={iconForCategory({ name: line.name, icon: line.icon }) as any}
            size={child ? 13 : 15}
            color={child ? C.textSecondary : (dotColor ?? C.textSecondary)}
            style={s.rowIcon}
          />
          <Text style={[s.rowName, child && s.rowNameChild]} numberOfLines={1}>{line.name}</Text>
          <BudgetAmounts spent={line.spent} budget={line.budget} symbol={CURRENCY_SYMBOL} suffix={yearly ? '· an' : undefined} />
        </View>
        <BudgetGauge spent={line.spent} budget={line.budget} compact={child} />
        <Text style={[s.rowNote, child && s.rowNoteChild, { color: over ? C.warning : C.textSecondary }]}>
          {over
            ? `Dépassé de ${fmt(-line.remaining)} ${CURRENCY_SYMBOL}`
            : `${fmt(line.remaining)} ${CURRENCY_SYMBOL} restants`}
          {line.inherited ? ` · repris de ${periodLabel(line.period, line.fromKey)}` : ''}
        </Text>
      </TouchableOpacity>
      {line.children.map((c) => (
        <Row key={c.categoryId} line={c} first={false} styles={s} yearly={yearly} depth={depth + 1} />
      ))}
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    content: { paddingBottom: 110 },
    loading: { paddingTop: 80, alignItems: 'center' },
    monthRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10,
    },
    monthLabelWrap: { flex: 1, alignItems: 'center' },
    monthLabel: { fontSize: 14, fontWeight: '700', color: c.text, textTransform: 'capitalize' },
    monthHint: { fontSize: 9.5, color: c.textSecondary, marginTop: 1 },
    /* HAUTEUR FIXE, et c'est le point important : la bascule mois/an n'existe que dans l'onglet
       « Catégories ». Sans hauteur imposée, la rangée se réglait sur son plus grand enfant — donc
       elle rétrécissait de quelques pixels en passant sur « Historique », et les onglets juste
       au-dessus remontaient d'autant. Une hauteur fixe rend la rangée insensible à son contenu.
       Elle est serrée exprès : cette rangée doit tenir dans l'espace qui existait déjà entre la
       période et les onglets. */
    actionRow: { flexDirection: 'row', alignItems: 'stretch', height: 40, gap: 8, marginBottom: 8 },
    /* Ni fond ni contour — la tuile est posée À NU, comme les actions de la fiche compte. */
    editTile: {
      flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    /* Le rond d'ENCRE : c'est lui qui rattache la tuile aux actions de la fiche compte. Il prend la
       couleur du texte (donc noir en clair, blanc en sombre) et l'icône prend celle du fond — le
       négatif exact, comme là-bas. */
    editTileIcon: {
      width: 26, height: 26, borderRadius: 999,
      alignItems: 'center', justifyContent: 'center',
      // `overflow` : le dégradé suit l'arrondi au lieu d'en déborder (Android).
      overflow: 'hidden',
    },
    editTileLabel: { fontSize: 12.5, fontWeight: '700', color: c.text },
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, padding: 16, marginBottom: 10,
    },
    kicker: { fontSize: 10.5, letterSpacing: 0.7, textTransform: 'uppercase', fontWeight: '700', color: c.textSecondary, marginBottom: 4 },
    /* `alignItems: flex-start` : la colonne de texte commence EN HAUT de l'anneau. Centrée, elle
       débordait sous lui dès la deuxième ligne — et c'est précisément la place qu'on cherche à ne
       pas perdre. */
    heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
    heroText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    big: { fontSize: 23, fontWeight: '800', color: c.text, letterSpacing: -0.5, textAlign: 'right' },
    bigSub: { fontSize: 13.5, fontWeight: '600', color: c.textSecondary },
    sub: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, marginTop: 8 },
    // Variante ALIGNÉE À DROITE : elle n'appartient qu'à la colonne de l'anneau. `sub` sert aussi
    // aux états vides et à l'historique, où un texte fuyant à droite n'aurait aucun sens.
    heroSub: { fontSize: 11.5, lineHeight: 16, color: c.textSecondary, marginTop: 4, textAlign: 'right' },
    row: {},
    // Une parente s'éloigne de la précédente ; son enfant lui reste collé — le groupe se lit d'un bloc.
    rowGap: { marginTop: 18 },
    rowChildGap: { marginTop: 10 },
    rowChild: { marginLeft: 6, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.cardBorder },
    rowIcon: { marginRight: -2, alignSelf: 'center' },
    /* Ligne mise en lumière : un fond très dilué qui déborde légèrement, pour qu'on voie
       laquelle des tranches de l'anneau on est en train de lire. */
    rowOn: {
      backgroundColor: c.primary + '10',
      marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10,
    },
    rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    rowName: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, fontSize: 14, fontWeight: '700', color: c.text },
    rowNameChild: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    rowAmounts: { fontSize: 12.5, color: c.textSecondary },
    rowNote: { fontSize: 11.5, color: c.textSecondary, marginTop: 5 },
    rowNoteChild: { fontSize: 10.5, marginTop: 4 },
    catLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 16 },
    catLinkText: { fontSize: 13, fontWeight: '700', color: c.primary },
    emptyWrap: { paddingTop: 40, paddingBottom: 120, alignItems: 'center' },
    emptyIcon: {
      width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.primary + '1A', marginBottom: 16,
    },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8 },
    emptyText: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, textAlign: 'center', maxWidth: 320 },
  });
}
