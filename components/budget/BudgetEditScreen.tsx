/**
 * ÉDITION DES BUDGETS — un écran plein, pas une feuille qui monte du bas.
 *
 * ── POURQUOI UNE PAGE ──────────────────────────────────────────────────────────────────────────
 * On y renseigne plusieurs lignes à la suite, au clavier. Une feuille occupe la moitié de l'écran,
 * le clavier en prend encore la moitié : il restait trois lignes visibles sur vingt. Les projets
 * ont fait le même chemin (`AddProjectModal` est devenu une route) — les budgets suivent.
 *
 * ── IL N'Y A PLUS DE BUDGET GLOBAL ─────────────────────────────────────────────────────────────
 * « 1 200 € au total » ne dit rien d'actionnable au moment de faire ses courses, et Relyka répond
 * déjà mieux à cette question avec l'enveloppe variable, qui est CALCULÉE au lieu d'être devinée.
 * On commence donc directement par les catégories (migration 218).
 *
 * ── AUCUN BLOCAGE ──────────────────────────────────────────────────────────────────────────────
 * Pas d'étapes, pas de champ obligatoire, pas de somme à faire tomber juste. On renseigne ce qu'on
 * veut, on enregistre, on revient quand on veut. Un champ vidé retire le budget (montant 0 : on ne
 * supprime pas la ligne, sinon le report ferait revenir celle du mois précédent).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ScreenGradient from '../layout/ScreenGradient';
import ScreenHeader from '../layout/ScreenHeader';
import AppButton from '../ui/AppButton';
import SegmentedControl from '../ui/SegmentedControl';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { pageColumn } from '../../lib/ui/webLayout';
import { useNavBack } from '../../hooks/platform/useNavBack';
import { useAuth } from '../../contexts/AuthContext';
import { useKeyboardAwareScroll } from '../../hooks/platform/useKeyboardAwareScroll';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { sanitizeAmountInput, parseAmountInput } from '../../lib/ui/amountInput';
import { describeWriteError } from '../../lib/ui/writeErrors';
import { todayISO } from '../../lib/dateUtils';
import { addMonthKey, monthLabel } from '../../lib/finance/monthKeys';
import { variableSpentByCategory } from '../../lib/finance/variableSpend';
import { isMovementsCategory } from '../../lib/ui/defaultCategories';
import { useBudgetContext } from '../../hooks/data/useBudgetData';
import { useSetBudgets, type SetBudgetInput } from '../../hooks/data/useBudgets';
import { effectiveBudget, monthKeyOf, yearKeyOf, type BudgetPeriod } from '../../lib/finance/budgetEngine';

type Level = 'parent' | 'sub';

interface Draft {
  amount: string;
  period: BudgetPeriod;
}

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export default function BudgetEditScreen() {
  const C = useAppColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ month?: string }>();
  const { scrollRef, handleFocus, onScroll, keyboardPadding, keyboardHeight } = useKeyboardAwareScroll();

  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  /* Le paramètre d'URL est VALIDÉ, jamais utilisé tel quel : on arrive aussi ici par un lien, un
     favori ou un retour de navigateur. Une clé fantaisiste donnait un titre « Invalid Date » puis un
     refus du serveur à l'enregistrement (la contrainte SQL exige 'YYYY-MM'), sans que rien
     n'explique pourquoi. */
  const paramMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.month ?? '')) ? String(params.month) : null;
  /* ON N'ÉCRIT JAMAIS DANS LE PASSÉ. Un budget est une décision qu'on prend AVANT ; le réécrire
     après coup permettrait de se fabriquer un historique flatteur. Surtout, ça ne restait pas dans
     le passé : par le report implicite, poser 1 200 € sur mars changeait avril, mai et tous les mois
     suivants qui n'ont pas leur propre ligne. On édite donc le mois affiché s'il est à venir, le
     mois en cours sinon — et on le DIT. */
  const monthKey = paramMonth && paramMonth > currentMonth ? paramMonth : currentMonth;
  const redirectedFromPast = paramMonth != null && paramMonth < currentMonth;
  const yearKey = yearKeyOf(monthKey);

  const ctx = useBudgetContext(user?.id);
  const setBudgets = useSetBudgets(user?.id);
  const lock = useSubmitLock();
  const [busy, setBusy] = useState(false);

  const [level, setLevel] = useState<Level>('parent');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);

  /* Moyenne des trois mois précédents, par catégorie — le repère qui rend le champ remplissable.
     Sans lui, on demande un chiffre que personne n'a en tête. */
  const avgByCat = useMemo(() => {
    const totals = new Map<string, number>();
    if (!ctx.isReady) return totals;
    /* On divise par les mois RÉELLEMENT VÉCUS, pas par 3.
       Quelqu'un qui utilise l'app depuis cinq semaines n'a qu'un mois complet derrière lui : diviser
       ses 300 € de courses par trois affichait « ~ 100 €/mois » sous le champ. C'est le seul repère
       de l'écran, celui sur lequel il va caler son budget — le donner trois fois trop bas fabrique un
       budget intenable, puis un dépassement, puis l'impression que l'app se trompe. */
    let monthsWithData = 0;
    for (let i = 1; i <= 3; i++) {
      const mk = addMonthKey(monthKey, -i);
      const byCat = variableSpentByCategory(ctx.fluxTx, ctx.accountTypeById, { prefix: mk });
      let monthHasSpending = false;
      for (const [catId, amount] of byCat) {
        if (amount <= 0) continue;
        monthHasSpending = true;
        if (!catId) continue;
        totals.set(catId, (totals.get(catId) ?? 0) + amount);
      }
      if (monthHasSpending) monthsWithData += 1;
    }
    const divisor = Math.max(1, monthsWithData);
    for (const [k, v] of totals) totals.set(k, v / divisor);
    return totals;
  }, [ctx.isReady, ctx.fluxTx, ctx.accountTypeById, monthKey]);

  /**
   * Moyenne d'une parente = la sienne PLUS celle de TOUTE sa descendance (une dépense est rangée au
   * niveau fin). Récursif comme le rollup du moteur : s'arrêter au premier niveau sous-estimait le
   * repère dès qu'une hiérarchie descend plus bas, et les deux écrans n'auraient pas dit la même
   * chose de la même catégorie.
   */
  const rolledAvg = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let sum = avgByCat.get(id) ?? 0;
    for (const c of ctx.categories) if (c.parent_id === id) sum += rolledAvg(c.id, seen);
    return sum;
  };

  /* TOUTES les catégories du niveau choisi — pas seulement les plus grosses. L'utilisateur doit
     pouvoir cadrer ce qu'il veut, y compris un poste modeste. Celles où il dépense le plus
     remontent en tête : c'est là que se pose la question, et le reste suit par ordre alphabétique
     pour rester trouvable.

     En SOUS-CATÉGORIES, la liste est découpée par catégorie parente. À plat, c'est quarante à
     soixante lignes d'affilée sans repère : on ne sait plus où l'on est, et on ne retrouve pas
     « Restaurants » sans tout parcourir. Les sections rendent la page balayable. */
  const sections = useMemo(() => {
    /* « Mouvements » (et ses sous-catégories) est hors budget : ce sont des virements internes,
       l'argent change de poche sans quitter le patrimoine. Il n'apparaît d'ailleurs jamais dans le
       dépensé — `isBudgetExpense` écarte tout ce qui porte un `linked_account_id` — donc un budget
       posé dessus resterait éternellement à 0. */
    const movementIds = new Set(
      ctx.categories.filter((c) => !c.parent_id && isMovementsCategory(c.name)).map((c) => c.id),
    );
    const expense = ctx.categories.filter(
      (c) => c.type === 'expense' && !movementIds.has(c.id) && !movementIds.has(c.parent_id ?? ''),
    );
    const parents = expense.filter((c) => !c.parent_id);
    const byAvgThenName = (a: { avg: number; name: string }, b: { avg: number; name: string }) =>
      b.avg - a.avg || a.name.localeCompare(b.name);

    if (level === 'parent') {
      return [{
        key: 'all',
        title: '',
        items: parents.map((c) => ({ id: c.id, name: c.name, avg: rolledAvg(c.id) })).sort(byAvgThenName),
      }];
    }

    return parents
      .map((p) => ({
        key: p.id,
        title: p.name,
        avg: rolledAvg(p.id),
        items: expense
          .filter((c) => c.parent_id === p.id)
          .map((c) => ({ id: c.id, name: c.name, avg: avgByCat.get(c.id) ?? 0 }))
          .sort(byAvgThenName),
      }))
      // Une parente sans sous-catégorie n'a rien à montrer ici : un titre suivi du vide se lit
      // comme une erreur de chargement.
      .filter((sec) => sec.items.length > 0)
      .sort((a, b) => b.avg - a.avg || a.title.localeCompare(b.title));
  }, [ctx.categories, level, avgByCat]);

  const hasRows = sections.some((sec) => sec.items.length > 0);

  /* On part TOUJOURS de ce qui est enregistré : rouvrir l'écran sur un brouillon abandonné
     laisserait croire qu'il a été enregistré.
     ── MAIS UNE SEULE FOIS ────────────────────────────────────────────────────────────────────────
     Cet effet dépendait de `ctx.budgets`, dont la RÉFÉRENCE change à chaque relecture — au retour de
     l'app en avant-plan, notamment. Il repartait alors de la base et remplaçait tout l'état du
     formulaire : les montants tapés depuis l'ouverture disparaissaient sous les yeux de
     l'utilisateur, sans message. Une fois amorcé, le formulaire s'appartient : il ne se laisse plus
     réécrire par une lecture de fond. */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx.isReady) return;
    if (seededFor.current === monthKey) return;
    seededFor.current = monthKey;
    const next: Record<string, Draft> = {};
    for (const c of ctx.categories) {
      const m = effectiveBudget(ctx.budgets ?? [], 'month', monthKey, c.id);
      const y = effectiveBudget(ctx.budgets ?? [], 'year', yearKey, c.id);
      const useYear = (y?.amount ?? 0) > 0 && !((m?.amount ?? 0) > 0);
      const eff = useYear ? y : m;
      next[c.id] = {
        amount: (eff?.amount ?? 0) > 0 ? String(eff!.amount).replace(/\.00$/, '').replace('.', ',') : '',
        period: useYear ? 'year' : 'month',
      };
    }
    setDrafts(next);
  }, [ctx.isReady, ctx.budgets, ctx.categories, monthKey, yearKey]);

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { amount: '', period: 'month' }), ...patch } }));

  const monthlyTotal = useMemo(
    () => Object.entries(drafts).reduce((sum, [, d]) => (d.period === 'month' ? sum + (parseAmountInput(d.amount) ?? 0) : sum), 0),
    [drafts],
  );
  const filledCount = useMemo(
    () => Object.values(drafts).filter((d) => (parseAmountInput(d.amount) ?? 0) > 0).length,
    [drafts],
  );

  async function save() {
    if (!lock.acquire()) return;
    setBusy(true);
    setError(null);
    try {
      /* On n'envoie que ce qui a CHANGÉ par rapport à l'enregistré — y compris les passages à zéro,
         qui retirent un budget. Envoyer les quarante lignes à chaque fois écrirait des zéros sur
         des catégories jamais budgétées, et le report du mois suivant hériterait de ces zéros. */
      const inputs: SetBudgetInput[] = [];
      for (const c of ctx.categories) {
        const d = drafts[c.id];
        if (!d) continue;
        const value = parseAmountInput(d.amount) ?? 0;
        const key = d.period === 'year' ? yearKey : monthKey;
        const current = effectiveBudget(ctx.budgets ?? [], d.period, key, c.id);
        const currentAmount = current?.amount ?? 0;
        // Une valeur HÉRITÉE d'un mois antérieur doit être réécrite sur le mois affiché dès qu'on
        // la modifie — sinon on corrigerait le passé.
        const unchanged = currentAmount === value && (value === 0 || current?.fromKey === key);
        if (unchanged) continue;
        if (value === 0 && currentAmount === 0) continue;
        inputs.push({ period: d.period, periodKey: key, categoryId: c.id, amount: value });

        /* Changement de cadence : l'ancienne ligne doit être remise à zéro, sinon la catégorie
           porterait un budget mensuel ET un budget annuel, et l'écran afficherait les deux. */
        const other: BudgetPeriod = d.period === 'year' ? 'month' : 'year';
        const otherKey = other === 'year' ? yearKey : monthKey;
        if ((effectiveBudget(ctx.budgets ?? [], other, otherKey, c.id)?.amount ?? 0) > 0) {
          inputs.push({ period: other, periodKey: otherKey, categoryId: c.id, amount: 0 });
        }
      }
      if (inputs.length) await setBudgets.mutateAsync(inputs);
      goBack();
    } catch (e: unknown) {
      /* `describeWriteError` plutôt que le message brut : sinon on affichait la phrase de Postgres
         (« duplicate key value violates unique constraint… »), qui n'apprend rien à quelqu'un qui
         voulait juste fixer 200 € de courses, et ne dit pas quoi faire. */
      setError(describeWriteError(e));
    } finally {
      lock.release();
      setBusy(false);
    }
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <StatusBar style={C.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[s.safe, pageColumn(isDesktop, 'form')]} edges={['left', 'right']}>
        <ScreenHeader title="Budgets" onBack={goBack} />

        {/* Pas de `KeyboardAvoidingView` : `useKeyboardAwareScroll` réserve DÉJÀ la hauteur du
            clavier sous le contenu (`keyboardPadding`) et remonte le champ actif. Les deux ensemble
            réservaient cette hauteur deux fois sur iOS — un grand vide sous la dernière ligne — et
            empêchaient de remonter proprement la barre d'action. */}
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // `flex: 1` EXPLICITE : la liste doit occuper la place restante et défiler DEDANS. Sans
          // lui, elle prend la hauteur de ses quarante lignes et repousse la barre « Enregistrer »
          // hors de l'écran — c'est le conteneur retiré au-dessus qui le portait jusqu'ici.
          style={{ flex: 1 }}
          contentContainerStyle={[s.content, { paddingBottom: 120 }, keyboardPadding]}
        >
            <Text style={s.month}>{monthLabel(monthKey)}</Text>
            <Text style={s.lede}>
              {redirectedFromPast
                ? 'Un budget se décide à l’avance : tu modifies le mois en cours, pas un mois déjà passé. Renseigne ce que tu veux cadrer, laisse le reste vide.'
                : 'Renseigne ce que tu veux cadrer, laisse le reste vide. Tu peux revenir modifier à tout moment — les mois passés ne bougent jamais.'}
            </Text>

            {/* TANT QUE TOUT N'EST PAS LU, AUCUN CHAMP. Les champs se remplissent depuis la base :
                les afficher vides pendant la lecture donnait à croire que les budgets avaient été
                perdus — et si l'on commençait à taper, l'arrivée des données écrasait la saisie. */}
            {ctx.isError ? (
              <View style={s.card}>
                <Text style={s.empty}>
                  Tes budgets n’ont pas pu être chargés. Vérifie ta connexion et reviens sur cet
                  écran — rien n’a été modifié.
                </Text>
              </View>
            ) : !ctx.isReady ? (
              <View style={s.loading}><ActivityIndicator color={C.primary} /></View>
            ) : (
            <>
            {/* Le NIVEAU se choisit ici, pas ailleurs : cadrer « Alimentation » ou seulement
                « Restaurants » sont deux intentions différentes, et l'une n'empêche pas l'autre. */}
            <SegmentedControl
              options={[
                { value: 'parent', label: 'Grandes catégories' },
                { value: 'sub', label: 'Sous-catégories' },
              ]}
              value={level}
              onChange={(v) => setLevel(v as Level)}
              role="radio"
              style={{ marginBottom: 14 }}
            />

            {!hasRows && (
              <View style={s.card}>
                <Text style={s.empty}>
                  Aucune catégorie de dépense à ce niveau. Crée-en dans Catégories.
                </Text>
              </View>
            )}

            {sections.filter((sec) => sec.items.length > 0).map((sec) => (
              <View key={sec.key}>
                {!!sec.title && (
                  <Text style={s.sectionTitle} numberOfLines={1}>{sec.title}</Text>
                )}
                <View style={s.card}>
                  {sec.items.map((r, i) => {
                    const d = drafts[r.id] ?? { amount: '', period: 'month' as BudgetPeriod };
                    const on = (parseAmountInput(d.amount) ?? 0) > 0;
                    return (
                      <View key={r.id} style={[s.row, i > 0 && s.rowSep]}>
                        <View style={s.rowName}>
                          <Text style={[s.name, on && { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                            {r.name}
                          </Text>
                          <Text style={s.sub} numberOfLines={1}>
                            {r.avg > 0 ? `~ ${fmt(r.avg)} ${CURRENCY_SYMBOL}/mois` : 'aucune dépense récente'}
                          </Text>
                        </View>

                        {/* DEUX colonnes, pas trois. À trois (nom + champ + cadence), la ligne
                            dépassait la largeur de la carte : le nom se faisait rogner à GAUCHE et
                            le montant saisi allait se dessiner hors du cadre, à droite. La cadence
                            descend donc SOUS le champ, dans la même colonne — la ligne ne peut
                            plus déborder, quelle que soit la longueur du nom. */}
                        <View style={s.fieldCol}>
                          <View style={[s.inputWrap, on && { borderColor: C.primary, backgroundColor: C.primary + '14' }]}>
                            <TextInput
                              style={s.input}
                              value={d.amount}
                              onChangeText={(v) => setDraft(r.id, { amount: sanitizeAmountInput(v) })}
                              onFocus={handleFocus}
                              placeholder="0"
                              placeholderTextColor={C.textSecondary}
                              keyboardType="decimal-pad"
                              /* 7 caractères plafonnaient à 9 999,99 — impossible d'y écrire un
                                 budget ANNUEL de 12 000 € pour les vacances, ni un budget mensuel
                                 dans une devise à gros nombres (l'app est multi-devises). */
                              maxLength={10}
                              // Retaper par-dessus plutôt que corriger caractère par caractère :
                              // on ajuste un budget, on ne l'édite pas.
                              selectTextOnFocus
                              accessibilityLabel={`Budget pour ${r.name}`}
                            />
                            <Text style={s.symbol}>{CURRENCY_SYMBOL}</Text>
                          </View>

                          {/* La cadence n'apparaît qu'une fois un montant saisi : la proposer sur
                              quarante lignes vides, c'est quarante décisions à ne pas prendre. */}
                          {on && (
                            <View style={s.cadence}>
                              {(['month', 'year'] as BudgetPeriod[]).map((p) => (
                                <TouchableOpacity
                                  key={p}
                                  style={[s.cadenceBtn, d.period === p && { backgroundColor: C.primary + '1F' }]}
                                  onPress={() => setDraft(r.id, { period: p })}
                                  accessibilityRole="radio"
                                  accessibilityState={{ selected: d.period === p }}
                                >
                                  <Text style={[s.cadenceText, d.period === p && { color: C.primary, fontWeight: '800' }]}>
                                    {p === 'month' ? 'mois' : 'an'}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
            </>
            )}

            <TouchableOpacity
              style={s.catLink}
              onPress={() => router.push('/(tabs)/(secondary)/categories' as any)}
              accessibilityRole="button"
            >
              <Text style={s.catLinkText}>Gérer mes catégories</Text>
              <Ionicons name="chevron-forward" size={14} color={C.primary} />
            </TouchableOpacity>
          </ScrollView>

        {/* Barre d'action ÉPINGLÉE : avec quarante lignes, un bouton en fin de liste obligerait à
            tout parcourir pour enregistrer trois chiffres saisis en haut.
            Elle est REMONTÉE au-dessus du clavier : en edge-to-edge, la fenêtre n'est jamais
            redimensionnée (cf. useKeyboardHeight), donc le clavier recouvrait purement et simplement
            le bouton — on tapait un montant et il n'y avait plus rien à toucher pour l'enregistrer. */}
        <View style={[s.bar, keyboardHeight > 0 && { marginBottom: keyboardHeight }]}>
          {/* L'ERREUR SE LIT OÙ L'ON A CLIQUÉ. Elle s'affichait en haut de la page : après avoir
              rempli quarante lignes, on appuyait sur « Enregistrer » et il ne se passait
              visiblement rien — le message était trois écrans plus haut. */}
          {!!error && (
            <View style={s.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={C.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}
          <Text style={s.barSummary} numberOfLines={1}>
            {filledCount === 0
              ? 'Aucun budget pour l’instant'
              : `${filledCount} budget${filledCount > 1 ? 's' : ''} · ${fmt(monthlyTotal)} ${CURRENCY_SYMBOL}/mois`}
          </Text>
          {/* Désactivé tant que la lecture n'a pas abouti : enregistrer un formulaire qu'on n'a pas
              encore pu remplir depuis la base n'écrirait rien, tout en affichant un succès. */}
          <AppButton label="Enregistrer" size="lg" loading={busy} disabled={!ctx.isReady} onPress={save} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1, paddingHorizontal: 16 },
    content: { paddingTop: 4 },
    month: { fontSize: 15, fontWeight: '800', color: c.text, textTransform: 'capitalize', marginBottom: 4 },
    lede: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, marginBottom: 14 },
    loading: { paddingVertical: 60, alignItems: 'center' },
    errorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
      backgroundColor: c.danger + '14', borderWidth: 1, borderColor: c.danger + '55',
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    },
    errorText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: c.danger },
    sectionTitle: {
      fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '700',
      color: c.textSecondary, marginTop: 16, marginBottom: 7, paddingHorizontal: 2,
    },
    /* `overflow: hidden` sur la CARTE : filet de sécurité. Quoi qu'il arrive à la mise en page —
       nom très long, police agrandie par le système, moteur web capricieux — rien ne peut plus se
       dessiner en dehors du cadre. C'est exactement ce qui se produisait : le montant saisi
       apparaissait à côté de la carte au lieu d'être dans son champ. */
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 12, marginBottom: 4, overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    rowSep: { borderTopWidth: 1, borderTopColor: c.cardBorder },
    /* `flexShrink: 1` explicite ET `minWidth: 0` : sans le second, une colonne flexible refuse de
       descendre sous la largeur de son contenu et pousse ses voisines hors du cadre. */
    rowName: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    name: { fontSize: 13.5, fontWeight: '600', color: c.textSecondary },
    sub: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    // Colonne de droite, largeur FIXE : le champ et sa cadence l'un sous l'autre.
    fieldCol: { width: 96, flexGrow: 0, flexShrink: 0 },
    inputWrap: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      borderWidth: 1.5, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 10, height: 42, backgroundColor: c.bg,
      ...(Platform.OS === 'web' ? { cursor: 'text' } as any : {}),
    },
    input: {
      flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: c.text, padding: 0,
      textAlign: 'right', fontVariant: ['tabular-nums'],
      // Le web pose une bordure et un fond par défaut sur `<input>` : sans ça, un second cadre
      // apparaît à l'intérieur du nôtre.
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', borderWidth: 0, backgroundColor: 'transparent' } as any : {}),
    },
    symbol: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
    cadence: {
      flexDirection: 'row', borderRadius: 9, padding: 2, marginTop: 5,
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    },
    cadenceBtn: { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 7 },
    cadenceText: { fontSize: 10.5, fontWeight: '600', color: c.textSecondary },
    empty: { fontSize: 13, lineHeight: 19, color: c.textSecondary, paddingVertical: 24, textAlign: 'center' },
    catLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 18 },
    catLinkText: { fontSize: 13, fontWeight: '700', color: c.primary },
    bar: {
      paddingTop: 10, paddingBottom: 14,
      borderTopWidth: 1, borderTopColor: c.cardBorder, backgroundColor: c.bg,
    },
    barSummary: { fontSize: 12, color: c.textSecondary, marginBottom: 8, textAlign: 'center' },
  });
}
