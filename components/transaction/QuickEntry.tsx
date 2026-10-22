/**
 * L'ÉCRAN DE SAISIE — dépense, recette ou virement, AU TAP : le montant au pavé, tout le reste en
 * pastilles, puis « Enregistrer ». Simple, mais complet : c'est le SEUL écran de saisie de l'app
 * (l'ancien formulaire en deux étapes a disparu), il porte donc tout ce qu'une saisie juste exige.
 *
 *  • Quand : aujourd'hui, hier, ou n'importe quel jour au calendrier.
 *  • Répétition : une fois, chaque semaine / mois / trimestre / année, avec date de fin facultative.
 *  • Catégorie (dépense, recette) : les plus utilisées en tuiles ; toutes les autres, la recherche
 *    et la CRÉATION d'une catégorie dans « Toutes les catégories ». Budget de la catégorie affiché.
 *  • Virement : de quel compte vers quel compte ; entre deux devises, le montant reçu ; retrait
 *    d'un compte d'investissement, la part de capital (règle du prorata).
 *  • Options : remboursement (dépense « à l'envers »), brouillon (à valider plus tard).
 *  • Projet en cours correspondant : rattachement proposé.
 *  • Libellé : facultatif, dans sa propre feuille (le clavier ne recouvre jamais le pavé).
 *
 * L'écran parent (transactions/add) lit l'URL (pré-remplissage d'une reco, saisie au nom d'un
 * membre…) et joue les suites de l'enregistrement ; celui-ci ne fait que la saisie.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import GardenSegmented from '../garden/GardenSegmented';
import GardenSheet from '../garden/GardenSheet';
import GardenButton from '../garden/GardenButton';
import AmountKeypad, { keypadNumber } from './AmountKeypad';
import AccountChipRow, { type ChipAccount } from './AccountChipRow';
import CategoryPicker, { useSubCategoriesGrouped } from './CategoryPicker';
import CalendarWithPicker from './CalendarWithPicker';
import BudgetInlineBlock from '../budget/BudgetInlineBlock';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import type { QuickTx } from '../../hooks/data/useQuickSave';
import { iconForCategory } from '../../lib/ui/categoryIcons';
import { convertAmount, currencySymbolFor } from '../../lib/finance/currency';
import { computeContributed } from '../../lib/finance/contributed';
import { matchProjectsForTransaction } from '../../lib/finance/projectMatch';
import { formatDateFrench, todayISO } from '../../lib/dateUtils';
import { REGUL_CATEGORY_NAME, WEALTH_REGUL_CATEGORY_NAME } from '../../lib/finance/regul';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import { pointer } from '../../lib/ui/webLayout';
import type { Category, Project, RecurrenceRule } from '../../types/database';

export type QuickKind = 'expense' | 'income' | 'transfer';
const TOP = 8;
/* Les catégories de régularisation (lib/finance/regul) ne se saisissent pas à la main. */
const HIDDEN = new Set([REGUL_CATEGORY_NAME, WEALTH_REGUL_CATEGORY_NAME].map((n) => n.toLowerCase()));
const hiddenCategory = (n: string) => HIDDEN.has(n.toLowerCase().trim());

const REPEATS: { key: RecurrenceRule | 'once'; label: string }[] = [
  { key: 'once', label: 'Une fois' },
  { key: 'weekly', label: 'Chaque semaine' },
  { key: 'monthly', label: 'Chaque mois' },
  { key: 'quarterly', label: 'Chaque trimestre' },
  { key: 'yearly', label: 'Chaque année' },
];

const shiftISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtAmount = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/**
 * Catégories à proposer en tuiles : les plus utilisées sur 4 mois (même sens d'argent), complétées
 * par l'ordre de l'écran Catégories. Pure, exportée pour les tests.
 */
export function rankCategories(children: Category[], txs: { category_id?: string | null; amount: number; date: string }[], kind: 'expense' | 'income', since: string): Category[] {
  const count = new Map<string, number>();
  for (const t of txs) {
    if (!t.category_id || t.date < since) continue;
    if (kind === 'expense' ? Number(t.amount) >= 0 : Number(t.amount) <= 0) continue;
    count.set(t.category_id, (count.get(t.category_id) ?? 0) + 1);
  }
  const usable = children.filter((c) => !hiddenCategory(c.name));
  const used = usable.filter((c) => count.has(c.id)).sort((a, b) => (count.get(b.id)! - count.get(a.id)!));
  return [...used, ...usable.filter((c) => !count.has(c.id))];
}

type Acc = ChipAccount & { type?: string; currency?: string | null; balance?: number | null };

export interface QuickInitial {
  amount?: string;
  note?: string;
  date?: string;
  categoryId?: string;
  recurrence?: RecurrenceRule | null;
  accountId?: string;
  toAccountId?: string;
}

interface Props {
  kind: QuickKind;
  onKind: (k: QuickKind) => void;
  /** Comptes où l'on peut écrire (tous types) ; dépense/recette n'en montrent que les comptes courants. */
  accounts: Acc[];
  defaultAccountId: string;
  categories: Category[];
  transactions: any[];
  projects: Project[];
  progressPctById: Record<string, number>;
  initial?: QuickInitial;
  /** Virement conseillé : destination limitée à ce type de compte (épargne / investissement). */
  destType?: string;
  /** Saisie au nom d'un membre d'un compte joint. */
  onBehalfName?: string;
  onCreateCategory: (name: string, parentId: string, icon: string, type: 'expense' | 'income') => Promise<string>;
  /** Enregistre (l'écran parent joue les suites et quitte l'écran). */
  onSubmit: (tx: QuickTx, attachedProject: Project | null) => Promise<void>;
}

export default function QuickEntry({ kind, onKind, accounts, defaultAccountId, categories, transactions, projects, progressPctById, initial, destType, onBehalfName, onCreateCategory, onSubmit }: Props) {
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [amountTo, setAmountTo] = useState('');
  const [amountToTouched, setAmountToTouched] = useState(false);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [repeat, setRepeat] = useState<RecurrenceRule | 'once'>(initial?.recurrence ?? 'once');
  const [endDate, setEndDate] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(initial?.accountId || defaultAccountId);
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [noteDraft, setNoteDraft] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'calendar' | 'endDate' | 'categories' | 'note' | 'amountTo'>(null);
  const [hint, setHint] = useState<string | null>(null);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();

  const isTransfer = kind === 'transfer';
  const isExpense = kind === 'expense';
  const catKind: 'expense' | 'income' = kind === 'income' ? 'income' : 'expense';
  const checking = useMemo(() => accounts.filter((a) => a.type === 'checking'), [accounts]);
  const destList = useMemo(() => (destType ? accounts.filter((a) => a.type === destType) : accounts), [accounts, destType]);
  const recurrence = repeat === 'once' ? null : repeat;

  // Changer de sens : la catégorie choisie n'a plus cours, le remboursement non plus.
  const [lastKind, setLastKind] = useState(kind);
  if (lastKind !== kind) { setLastKind(kind); setCategoryId(''); setIsRefund(false); setHint(null); }
  // Le compte doit rester valable : dépense/recette sur un compte courant, virement vers un autre compte.
  useEffect(() => {
    if (!accountId && defaultAccountId) setAccountId(defaultAccountId);
    if (!isTransfer && accountId && checking.length && !checking.some((a) => a.id === accountId)) setAccountId(checking.find((a) => a.id === defaultAccountId)?.id ?? checking[0].id);
    if (toAccountId && (toAccountId === accountId || !destList.some((a) => a.id === toAccountId))) setToAccountId('');
  }, [isTransfer, accountId, toAccountId, defaultAccountId, checking, destList]);

  const groups = useSubCategoriesGrouped(categories, catKind);
  const ranked = useMemo(() => rankCategories(groups.flatMap((g) => g.children), transactions, catKind, shiftISO(-120)), [groups, transactions, catKind]);
  // La catégorie choisie reste visible, même hors des plus utilisées (choisie dans la liste complète).
  const tiles = useMemo(() => {
    const top = ranked.slice(0, TOP);
    const chosen = categories.find((c) => c.id === categoryId);
    return chosen && !top.some((c) => c.id === chosen.id) ? [chosen, ...top.slice(0, TOP - 1)] : top;
  }, [ranked, categories, categoryId]);
  const parents = useMemo(() => categories
    .filter((c) => !c.parent_id && String(c.type).toLowerCase() === catKind && c.name.toLowerCase() !== 'mouvements')
    .map((c) => ({ id: c.id, name: c.name })), [categories, catKind]);

  const value = keypadNumber(amount);
  const src = accounts.find((a) => a.id === accountId);
  const dst = accounts.find((a) => a.id === toAccountId);
  const srcCur = src?.currency || 'EUR';
  const dstCur = dst?.currency || 'EUR';
  const symbol = currencySymbolFor(srcCur);
  const crossCurrency = isTransfer && !!src && !!dst && srcCur !== dstCur;
  const tone = isTransfer ? GARDEN_COLORS.waterText : isExpense && !isRefund ? GARDEN_COLORS.fruitsText : GARDEN_COLORS.branchesText;

  // Entre deux devises : le montant reçu est pré-rempli au taux du jour, tant qu'on ne l'a pas tapé.
  useEffect(() => {
    if (!crossCurrency || amountToTouched) return;
    const conv = value > 0 ? convertAmount(value, srcCur, dstCur, rates) : null;
    setAmountTo(conv != null ? String(Math.round(conv * 100) / 100).replace('.', ',') : '');
  }, [crossCurrency, amountToTouched, value, srcCur, dstCur, rates]);

  /* Retrait d'un compte d'investissement : la part de capital et de plus-value (règle du prorata). */
  const prorata = useMemo(() => {
    if (!isTransfer || recurrence || !src || src.type !== 'investment' || Number(src.balance) <= 0 || !(value > 0)) return null;
    const contributed = computeContributed(src as any, transactions as any);
    if (contributed == null) return null;
    const ratio = Math.min(1, contributed / Number(src.balance));
    return { pct: Math.round(ratio * 100), capital: value * ratio, plus: value * (1 - ratio), left: Math.max(0, contributed - value * ratio) };
  }, [isTransfer, recurrence, src, value, transactions]);

  /* Projet en cours correspondant (comptes d'un virement / compte + catégorie d'une dépense). Jamais
     pour une récurrente (chaque occurrence devrait l'être) ni pour un remboursement. */
  const matching = useMemo(() => {
    if (recurrence) return [];
    if (isTransfer && accountId && toAccountId) return matchProjectsForTransaction({ kind: 'transfer', accountId, targetAccountId: toAccountId, projects, progressPctById });
    if (isExpense && !isRefund && accountId && categoryId) return matchProjectsForTransaction({ kind: 'expense', accountId, categoryId, projects, progressPctById });
    return [];
  }, [recurrence, isTransfer, isExpense, isRefund, accountId, toAccountId, categoryId, projects, progressPctById]);
  useEffect(() => { if (projectId && !matching.some((p) => p.id === projectId)) setProjectId(null); }, [matching, projectId]);
  const attached = matching.find((p) => p.id === projectId) ?? null;

  const missing = !(value > 0) ? "Tape d'abord le montant"
    : !accountId ? (isTransfer ? 'Choisis le compte de départ' : 'Ajoute d’abord un compte courant')
    : isTransfer && !toAccountId ? "Choisis le compte d'arrivée"
    : crossCurrency && recurrence ? 'Un virement entre deux devises ne peut pas se répéter (le taux change)'
    : crossCurrency && !(keypadNumber(amountTo) > 0) ? 'Indique le montant reçu'
    : !isTransfer && !isDraft && !categoryId ? 'Choisis une catégorie'
    : endDate && endDate < date ? 'La date de fin doit suivre la première date'
    : null;

  const submit = async () => {
    if (missing) { setHint(missing); return; }
    const common = { date, note: note.trim() || undefined, recurrence, recurrenceEndDate: recurrence ? endDate : null, isDraft, projectId: attached?.id ?? null };
    const tx: QuickTx = isTransfer
      ? { ...common, accountId, toAccountId, amount: value, amountTo: crossCurrency ? keypadNumber(amountTo) : undefined,
        noteFrom: `Virement vers ${dst?.name ?? ''}`.trim(), noteTo: `Virement depuis ${src?.name ?? ''}`.trim(),
        projectDraft: !!attached && (isDraft || date > todayISO()) }
      : { ...common, accountId, categoryId: categoryId || null, amount: isExpense && !isRefund ? -value : value };
    await onSubmit(tx, attached);
  };

  const chip = (label: string, on: boolean, onPress: () => void, icon?: string) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 36, borderRadius: GARDEN_RADII.pill,
        backgroundColor: on ? GARDEN_COLORS.primary : hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card, borderWidth: 1, borderColor: on ? GARDEN_COLORS.primary : GARDEN_COLORS.line }, pointer]}>
      {icon ? <Ionicons name={icon as any} size={15} color={on ? GARDEN_COLORS.onPrimary : GARDEN_COLORS.inkSoft} /> : null}
      <GardenText variant="smallStrong" color={on ? GARDEN_COLORS.onPrimary : GARDEN_COLORS.inkSoft}>{label}</GardenText>
    </Pressable>
  );
  const label = (t: string) => <GardenText variant="label" style={{ marginTop: 4 }}>{t}</GardenText>;
  const notice = (text: string) => (
    <View style={{ padding: 10, borderRadius: GARDEN_RADII.md, backgroundColor: GARDEN_COLORS.notice }}>
      <GardenText variant="small" color={GARDEN_COLORS.noticeText}>{text}</GardenText>
    </View>
  );

  const quickDates: [string, string][] = [[todayISO(), "Aujourd'hui"], [shiftISO(-1), 'Hier']];
  const otherDate = !quickDates.some(([d]) => d === date);
  const sign = isExpense && !isRefund && amount ? '− ' : (isRefund && amount ? '+ ' : '');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: GARDEN_SPACE.sm, paddingBottom: GARDEN_SPACE.lg, gap: GARDEN_SPACE.sm }} keyboardShouldPersistTaps="handled">
        {onBehalfName ? notice(`Saisie au nom de ${onBehalfName}`) : null}
        <GardenSegmented accessibilityLabel="Type d'opération" value={kind} onChange={(k) => onKind(k as QuickKind)}
          items={[{ key: 'expense', label: 'Dépense' }, { key: 'income', label: 'Recette' }, { key: 'transfer', label: 'Virement' }]} />

        {/* Le montant, en grand */}
        <View style={{ alignItems: 'center', paddingVertical: GARDEN_SPACE.xs }}>
          <GardenText variant="amount" tabular adjustsFontSizeToFit numberOfLines={1} accessibilityLiveRegion="polite"
            color={amount ? tone : GARDEN_COLORS.muted} style={{ fontSize: 46, lineHeight: 54 }}>
            {sign}{amount || '0'} {symbol}
          </GardenText>
          <Pressable onPress={() => { setNoteDraft(note); setSheet('note'); }} accessibilityRole="button" style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }, pointer]}>
            <Ionicons name="create-outline" size={15} color={GARDEN_COLORS.primary} />
            <GardenText variant="smallStrong" color={note ? GARDEN_COLORS.ink : GARDEN_COLORS.primary} numberOfLines={1}>{note || 'Ajouter un libellé'}</GardenText>
          </Pressable>
        </View>

        {isTransfer ? (
          <>
            {label('De')}
            <AccountChipRow accounts={accounts} activeId={accountId} onSelect={setAccountId} />
            {label('Vers')}
            <AccountChipRow accounts={destList} activeId={toAccountId} disabledId={accountId} onSelect={setToAccountId} />
            {accounts.length < 2 ? <GardenText variant="small" color={GARDEN_COLORS.muted}>Il faut au moins deux comptes pour faire un virement.</GardenText> : null}
            {destType && destList.length === 0 ? <GardenText variant="small" color={GARDEN_COLORS.muted}>Aucun compte {destType === 'savings' ? "d'épargne" : "d'investissement"} : ajoutes-en un dans Mon argent.</GardenText> : null}
            {crossCurrency ? (
              <Pressable onPress={() => setSheet('amountTo')} accessibilityRole="button" style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: GARDEN_COLORS.line, backgroundColor: GARDEN_COLORS.card }, pointer]}>
                <GardenText variant="body">Montant reçu sur {dst?.name}</GardenText>
                <GardenText variant="bodyStrong" tabular color={GARDEN_COLORS.primary}>{amountTo || '0'} {currencySymbolFor(dstCur)} ›</GardenText>
              </Pressable>
            ) : null}
            {prorata ? notice(`Retrait d'un placement : ${prorata.pct} % de capital (${fmtAmount(Math.round(prorata.capital))} ${symbol}) et ${100 - prorata.pct} % de plus-value (${fmtAmount(Math.round(prorata.plus))} ${symbol}). Apport restant : ${fmtAmount(Math.round(prorata.left))} ${symbol}.`) : null}
          </>
        ) : (
          <>
            {checking.length > 1 ? <>{label('Compte')}<AccountChipRow accounts={checking} activeId={accountId} onSelect={setAccountId} /></> : null}
            {label('Catégorie')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {tiles.map((c) => {
                const on = c.id === categoryId;
                return (
                  <Pressable key={c.id} onPress={() => { setCategoryId(c.id); setHint(null); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name}
                    style={({ pressed, hovered }: any) => [{
                      width: '23%', flexGrow: 1, minHeight: 78, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4, paddingVertical: 8,
                      borderRadius: GARDEN_RADII.md, borderWidth: on ? 2 : 1, borderColor: on ? GARDEN_COLORS.primary : GARDEN_COLORS.line,
                      backgroundColor: on ? GARDEN_COLORS.branchesBg : pressed ? GARDEN_COLORS.track : hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card,
                    }, pointer]}>
                    <Ionicons name={iconForCategory(c) as any} size={22} color={on ? GARDEN_COLORS.primary : tone} />
                    <GardenText variant="smallStrong" center numberOfLines={2} style={{ fontSize: 12 }}>{c.name}</GardenText>
                  </Pressable>
                );
              })}
            </View>
            <GardenButton label="Toutes les catégories / en créer une" variant="secondary" icon={<Ionicons name="grid-outline" size={18} color={GARDEN_COLORS.primary} />} onPress={() => setSheet('categories')} />
            {/* Le budget de la catégorie, en direct (se tait sans budget, sur une récurrente ou hors compte courant). */}
            {!recurrence ? <BudgetInlineBlock categoryId={categoryId || null} date={date} amount={value} accountType={src?.type ?? null} hidden={!isExpense || isRefund} /> : null}
          </>
        )}

        {label('Quand ?')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {quickDates.map(([d, l]) => chip(l, date === d, () => setDate(d)))}
          {chip(otherDate ? formatDateFrench(date) : 'Autre date', otherDate, () => setSheet('calendar'), 'calendar-outline')}
        </View>

        {label('Répétition')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {REPEATS.map((r) => chip(r.label, repeat === r.key, () => { setRepeat(r.key); if (r.key !== 'once') { setIsRefund(false); setIsDraft(false); } }))}
        </View>
        {recurrence ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {chip(endDate ? `Jusqu'au ${formatDateFrench(endDate)}` : 'Sans date de fin', !!endDate, () => setSheet('endDate'), 'flag-outline')}
            {endDate ? chip('Retirer la fin', false, () => setEndDate(null)) : null}
          </View>
        ) : null}

        {!recurrence ? (
          <>
            {label('Options')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {isExpense ? chip('Remboursement', isRefund, () => setIsRefund((v) => !v), 'return-down-back-outline') : null}
              {chip('À valider plus tard', isDraft, () => setIsDraft((v) => !v), 'time-outline')}
            </View>
            {isRefund ? <GardenText variant="small" color={GARDEN_COLORS.muted}>Une entrée d'argent qui vient en déduction de cette catégorie de dépense.</GardenText> : null}
            {isDraft ? <GardenText variant="small" color={GARDEN_COLORS.muted}>Enregistrée en brouillon : elle ne compte pas tant que tu ne l'as pas validée.</GardenText> : null}
          </>
        ) : null}

        {matching.length ? (
          <>
            {label(matching.length > 1 ? 'Projets correspondants' : 'Projet correspondant')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {chip('Aucun', !projectId, () => setProjectId(null))}
              {matching.map((p) => chip(`${p.name} · ${Math.round(progressPctById[p.id] ?? 0)} %`, projectId === p.id, () => setProjectId(p.id), 'flag-outline'))}
            </View>
            {attached ? <GardenText variant="small" color={GARDEN_COLORS.muted}>{isTransfer && (isDraft || date > todayISO())
              ? 'Datée dans le futur : elle sera créée comme une échéance à valider du projet.'
              : "L'avancement du projet sera mis à jour ; l'échéance prévue ce mois-ci est remplacée par cette saisie."}</GardenText> : null}
          </>
        ) : null}
      </ScrollView>

      {/* Le pavé et le bouton qui conclut restent en bas, sous le pouce */}
      <View style={{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: GARDEN_SPACE.sm, paddingBottom: GARDEN_SPACE.md, gap: GARDEN_SPACE.sm, borderTopWidth: 1, borderTopColor: GARDEN_COLORS.line, backgroundColor: GARDEN_COLORS.bg }}>
        <AmountKeypad value={amount} onChange={(v) => { setAmount(v); setHint(null); }} onEnter={submit} active={!sheet} />
        {hint ? <GardenText variant="smallStrong" color={GARDEN_COLORS.noticeText} center>{hint}</GardenText> : null}
        <GardenButton label={value > 0 ? `${isDraft ? 'Enregistrer en brouillon' : 'Enregistrer'} ${amount} ${symbol}` : 'Enregistrer'} onPress={submit} />
      </View>

      <GardenSheet visible={sheet === 'calendar' || sheet === 'endDate'} onClose={() => setSheet(null)} title={sheet === 'endDate' ? 'Dernière fois le…' : 'Choisir une date'}>
        <CalendarWithPicker current={(sheet === 'endDate' ? endDate : null) ?? date} minDate={sheet === 'endDate' ? date : undefined} maxDate="2050-12-31"
          onDayPress={(day) => { if (sheet === 'endDate') setEndDate(day.dateString); else setDate(day.dateString); setSheet(null); }}
          markedDates={{ [(sheet === 'endDate' ? endDate : date) ?? date]: { selected: true, selectedColor: GARDEN_COLORS.primary, selectedTextColor: GARDEN_COLORS.onPrimary } }}
          accentColor={GARDEN_COLORS.primary} bgColor={GARDEN_COLORS.card} textColor={GARDEN_COLORS.ink} textSecondaryColor={GARDEN_COLORS.muted} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'categories'} onClose={() => setSheet(null)} title="Toutes les catégories" subtitle="cherche, choisis, ou crée la tienne">
        <CategoryPicker key={catKind} groups={groups.map((g) => ({ ...g, children: g.children.filter((c) => !hiddenCategory(c.name)) }))} selectedCategoryId={categoryId}
          onSelect={(id) => { setCategoryId(id); setHint(null); setSheet(null); }} label="Catégorie" parents={parents}
          onCreateSubcategory={(name, parentId, icon) => onCreateCategory(name, parentId, icon, catKind)} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'amountTo'} onClose={() => setSheet(null)} title={`Montant reçu sur ${dst?.name ?? ''}`} subtitle={`en ${dstCur}, pré-rempli au taux du jour`}
        footer={<GardenButton label="OK" onPress={() => setSheet(null)} />}>
        <GardenText variant="amount" tabular center>{amountTo || '0'} {currencySymbolFor(dstCur)}</GardenText>
        <AmountKeypad value={amountTo} onChange={(v) => { setAmountTo(v); setAmountToTouched(true); setHint(null); }} active={sheet === 'amountTo'} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'note'} onClose={() => setSheet(null)} title="Libellé" subtitle="facultatif : « Courses Lidl », « Loyer »…"
        footer={<GardenButton label="OK" onPress={() => { setNote(noteDraft.trim()); setSheet(null); }} />}>
        <TextInput value={noteDraft} onChangeText={setNoteDraft} autoFocus placeholder="Libellé" placeholderTextColor={GARDEN_COLORS.muted} returnKeyType="done"
          onSubmitEditing={() => { setNote(noteDraft.trim()); setSheet(null); }} accessibilityLabel="Libellé"
          style={{ fontFamily: GF.body, minHeight: 52, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: GARDEN_COLORS.line, backgroundColor: GARDEN_COLORS.card, paddingHorizontal: 14, fontSize: 17, color: GARDEN_COLORS.ink }} />
      </GardenSheet>
    </View>
  );
}
