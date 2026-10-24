/**
 * NOUVEAU PROJET — au tap, sur un seul écran, comme la saisie d'une opération :
 *   1. ce que tu veux faire : mettre de côté, conserver pour plus tard, dépenser petit à petit ;
 *   2. le nom (suggestions en un tap, ou le tien) et le montant à atteindre, au pavé ;
 *   3. le rythme : un montant chaque mois, ou une date à atteindre (la mensualité se calcule) ;
 *   4. les comptes (et la catégorie d'un projet « dépenser »), puis la première échéance ;
 *   5. « Créer le projet ».
 * Même écriture que l'écran complet (useAddProject : échéancier généré par le hook), avec ses
 * garde-fous (lecture seule, verrou de double appui, limite d'usage). L'écran complet reste celui
 * de la MODIFICATION (échéances ponctuelles, description…).
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import ScreenHeader from '../layout/ScreenHeader';
import GardenGlow from '../garden/GardenGlow';
import GardenText from '../garden/GardenText';
import GardenSheet from '../garden/GardenSheet';
import GardenButton from '../garden/GardenButton';
import AmountKeypad, { keypadNumber } from '../transaction/AmountKeypad';
import AccountChipRow from '../transaction/AccountChipRow';
import CalendarWithPicker from '../transaction/CalendarWithPicker';
import CategoryPicker, { useSubCategoriesGrouped } from '../transaction/CategoryPicker';
import { useAuth } from '../../contexts/AuthContext';
import { useNavBack } from '../../hooks/platform/useNavBack';
import { useAccounts } from '../../hooks/data/useAccounts';
import { useCategories, useAddCategory } from '../../hooks/data/useCategories';
import { useAddProject } from '../../hooks/data/useProjects';
import { useUsageGuard } from '../../hooks/config/useUsageLimits';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { monthlyOccurrenceCount } from '../../lib/finance/recurrence';
import { isMovementsCategory } from '../../lib/ui/defaultCategories';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { formatDateFrench, todayISO, dayOfMonthISO } from '../../lib/dateUtils';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import { pageColumn, pointer } from '../../lib/ui/webLayout';
import type { ProjectMode } from '../../lib/finance/projectTx';

const MODES: { key: ProjectMode; icon: string; title: string; sub: string }[] = [
  { key: 'transfer', icon: 'trending-up-outline', title: 'Mettre de côté', sub: 'sur ton épargne ou tes placements' },
  { key: 'reserve', icon: 'lock-closed-outline', title: 'Conserver', sub: "l'argent reste sur ton compte" },
  { key: 'spend', icon: 'card-outline', title: 'Dépenser', sub: 'petit à petit, au fil des mois' },
];
const NAME_IDEAS = ['Voyage', 'Voiture', 'Travaux', 'Imprévus', 'Cadeaux', 'Mariage', 'Naissance', 'Vacances'];
const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
const firstOfNextMonth = () => {
  const d = new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
};
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function QuickProject() {
  const C = useAppColors();
  const { isDesktop } = useResponsive();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id || '');
  const { data: categories = [] } = useCategories(user?.id);
  const addCategory = useAddCategory(user?.id);
  const addProject = useAddProject(user?.id || '');
  const { guard } = useUsageGuard(user?.id);
  const lock = useSubmitLock();
  const ro = useReadOnlyGuard();

  const [mode, setMode] = useState<ProjectMode>('transfer');
  const [name, setName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [target, setTarget] = useState('');
  const [rhythm, setRhythm] = useState<'monthly' | 'date'>('monthly');
  const [monthly, setMonthly] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [firstDate, setFirstDate] = useState(todayISO());
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sheet, setSheet] = useState<null | 'name' | 'monthly' | 'targetDate' | 'firstDate' | 'category'>(null);
  const [hint, setHint] = useState<string | null>(null);

  const checking = useMemo(() => accounts.filter((a) => a.type === 'checking'), [accounts]);
  const wealthAccounts = useMemo(() => accounts.filter((a) => a.type === 'savings' || a.type === 'investment'), [accounts]);
  const defaultChecking = checking.find((a) => a.is_default)?.id ?? checking[0]?.id ?? '';
  const src = sourceId || defaultChecking;
  const dest = destId || (wealthAccounts.length === 1 ? wealthAccounts[0].id : '');
  const groups = useSubCategoriesGrouped(categories, 'expense');
  const parents = useMemo(() => categories
    .filter((c) => !c.parent_id && String(c.type).toLowerCase() === 'expense' && !isMovementsCategory(c.name))
    .map((c) => ({ id: c.id, name: c.name })), [categories]);
  const category = categories.find((c) => c.id === categoryId);

  const targetValue = keypadNumber(target);
  /* Le rythme : sans montant tapé, un an par défaut (comme l'écran complet) ; avec une date, la
     mensualité se calcule sur le nombre d'échéances réel (lib/finance/recurrence). */
  const monthlyValue = keypadNumber(monthly) || (targetValue > 0 ? Math.max(1, Math.ceil(targetValue / 12)) : 0);
  const dateMonthly = rhythm === 'date' && targetDate && targetValue > 0 && targetDate >= firstDate
    ? targetValue / Math.max(1, monthlyOccurrenceCount(firstDate, targetDate)) : null;
  const perMonth = rhythm === 'date' ? dateMonthly : monthlyValue;
  const monthsNeeded = rhythm === 'monthly' && monthlyValue > 0 && targetValue > 0 ? Math.ceil(targetValue / monthlyValue) : null;

  const missing = !name.trim() ? 'Donne un nom à ton projet'
    : !(targetValue > 0) ? 'Tape le montant à atteindre'
    : rhythm === 'date' && !dateMonthly ? 'Choisis la date à atteindre'
    : !src ? 'Ajoute d’abord un compte courant'
    : mode === 'transfer' && !dest ? "Choisis le compte d'épargne ou de placement"
    : mode === 'spend' && !categoryId ? 'Choisis la catégorie des dépenses'
    : null;

  const create = async () => {
    if (missing) { setHint(missing); return; }
    if (ro.blocked() || !lock.acquire()) return;
    if (!(await guard('project'))) { lock.release(); return; }
    addProject.mutate({
      name: name.trim(),
      target_amount: targetValue,
      monthly_allocation: perMonth ?? 0,
      allocation_type: rhythm,
      current_accumulated: 0,
      expense_category_id: mode === 'spend' ? categoryId : null,
      mode,
      source_account_id: src,
      linked_account_id: mode === 'transfer' ? dest : mode === 'reserve' ? src : undefined,
      transaction_day: dayOfMonthISO(firstDate) || 1,
      first_payment_date: firstDate,
      target_date: rhythm === 'date' ? targetDate : undefined,
    } as any, {
      onSuccess: () => goBack(),
      onError: (e: unknown) => { lock.release(); setHint(e instanceof Error ? e.message : "Le projet n'a pas pu être créé. Réessaie."); },
    });
  };

  const chip = (label: string, on: boolean, onPress: () => void, icon?: string) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 36, borderRadius: GARDEN_RADII.pill,
        backgroundColor: on ? G.primary : hovered ? G.field : G.card, borderWidth: 1, borderColor: on ? G.primary : G.line }, pointer]}>
      {icon ? <Ionicons name={icon as any} size={15} color={on ? G.onPrimary : G.inkSoft} /> : null}
      <GardenText variant="smallStrong" color={on ? G.onPrimary : G.inkSoft}>{label}</GardenText>
    </Pressable>
  );
  const label = (t: string) => <GardenText variant="label" style={{ marginTop: 4 }}>{t}</GardenText>;
  const nextMonth = firstOfNextMonth();
  const otherFirst = firstDate !== todayISO() && firstDate !== nextMonth;

  return (
    <View style={{ flex: 1, backgroundColor: G.bg }}>
      <StatusBar style={C.mode === 'light' ? 'dark' : 'light'} />
      <GardenGlow />
      <SafeAreaView style={[{ flex: 1 }, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title="Nouveau projet" onBack={goBack} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: GARDEN_SPACE.sm, paddingBottom: GARDEN_SPACE.lg, gap: GARDEN_SPACE.sm }} keyboardShouldPersistTaps="handled">
          {label('Tu veux')}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <Pressable key={m.key} onPress={() => { setMode(m.key); setHint(null); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${m.title}, ${m.sub}`}
                  style={({ hovered }: any) => [{ flex: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8, borderRadius: GARDEN_RADII.md, borderWidth: on ? 2 : 1, borderColor: on ? G.primary : G.line, backgroundColor: on ? G.branchesBg : hovered ? G.field : G.card }, pointer]}>
                  <Ionicons name={m.icon as any} size={22} color={on ? G.primary : G.inkSoft} />
                  <GardenText variant="smallStrong" center>{m.title}</GardenText>
                  <GardenText variant="small" color={G.muted} center style={{ fontSize: 11, lineHeight: 14 }}>{m.sub}</GardenText>
                </Pressable>
              );
            })}
          </View>

          {label('Pour quoi ?')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {NAME_IDEAS.map((n) => chip(n, name === n, () => { setName(n); setHint(null); }))}
            {chip(name && !NAME_IDEAS.includes(name) ? name : 'Autre nom…', !!name && !NAME_IDEAS.includes(name), () => { setNameDraft(NAME_IDEAS.includes(name) ? '' : name); setSheet('name'); }, 'create-outline')}
          </View>

          {/* Le montant à atteindre, en grand (le pavé en bas de l'écran) */}
          <View style={{ alignItems: 'center', paddingVertical: GARDEN_SPACE.xs }}>
            <GardenText variant="small" color={G.muted}>{mode === 'spend' ? 'Budget total du projet' : 'Montant à atteindre'}</GardenText>
            <GardenText variant="amount" tabular adjustsFontSizeToFit numberOfLines={1} color={target ? G.ink : G.muted} style={{ fontSize: 44, lineHeight: 52 }}>{target || '0'} {CURRENCY_SYMBOL}</GardenText>
          </View>

          {label('Le rythme')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chip(`Chaque mois${monthlyValue > 0 ? ` : ${fmt(monthlyValue)}` : ''}`, rhythm === 'monthly', () => { setRhythm('monthly'); if (rhythm === 'monthly') setSheet('monthly'); }, 'repeat-outline')}
            {chip(targetDate && rhythm === 'date' ? `Avant ${monthYear(targetDate)}` : 'Avant une date', rhythm === 'date', () => { setRhythm('date'); setSheet('targetDate'); }, 'flag-outline')}
          </View>
          {perMonth && targetValue > 0 ? (
            <GardenText variant="small" color={G.inkSoft}>
              {rhythm === 'date' ? `≈ ${fmt(perMonth)} par mois jusqu'en ${monthYear(targetDate)}.` : `Objectif atteint en ${monthsNeeded} mois. Touche « Chaque mois » pour changer le montant.`}
            </GardenText>
          ) : null}

          {mode === 'transfer' ? (
            <>
              {label('De')}
              <AccountChipRow accounts={checking as any} activeId={src} onSelect={setSourceId} />
              {label('Vers')}
              {wealthAccounts.length ? <AccountChipRow accounts={wealthAccounts as any} activeId={dest} onSelect={(id) => { setDestId(id); setHint(null); }} />
                : <GardenText variant="small" color={G.muted}>Aucun compte d'épargne ou de placement : ajoutes-en un dans Mon argent, ou choisis « Conserver ».</GardenText>}
            </>
          ) : (
            <>
              {checking.length > 1 ? <>{label(mode === 'spend' ? 'Compte des dépenses' : "Compte où l'argent reste")}<AccountChipRow accounts={checking as any} activeId={src} onSelect={setSourceId} /></> : null}
              {mode === 'spend' ? (
                <>
                  {label('Catégorie des dépenses')}
                  <GardenButton label={category ? category.name : 'Choisir la catégorie'} variant="secondary" icon={<Ionicons name="pricetags-outline" size={18} color={G.primary} />} onPress={() => setSheet('category')} />
                </>
              ) : null}
            </>
          )}

          {label('Première fois')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chip('Ce mois-ci', firstDate === todayISO(), () => setFirstDate(todayISO()))}
            {chip('Le mois prochain', firstDate === nextMonth, () => setFirstDate(nextMonth))}
            {chip(otherFirst ? formatDateFrench(firstDate) : 'Autre date', otherFirst, () => setSheet('firstDate'), 'calendar-outline')}
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: GARDEN_SPACE.sm, paddingBottom: GARDEN_SPACE.md, gap: GARDEN_SPACE.sm, borderTopWidth: 1, borderTopColor: G.line, backgroundColor: G.bg }}>
          <AmountKeypad value={target} onChange={(v) => { setTarget(v); setHint(null); }} active={!sheet} />
          {hint ? <GardenText variant="smallStrong" color={G.noticeText} center>{hint}</GardenText> : null}
          <GardenButton label="Créer le projet" onPress={create} loading={addProject.isPending} />
        </View>
      </SafeAreaView>

      <GardenSheet visible={sheet === 'name'} onClose={() => setSheet(null)} title="Nom du projet"
        footer={<GardenButton label="OK" onPress={() => { setName(nameDraft.trim()); setSheet(null); setHint(null); }} />}>
        <TextInput value={nameDraft} onChangeText={setNameDraft} autoFocus placeholder="Ex. Week-end à Rome" placeholderTextColor={G.muted} returnKeyType="done" accessibilityLabel="Nom du projet"
          onSubmitEditing={() => { setName(nameDraft.trim()); setSheet(null); setHint(null); }}
          style={{ fontFamily: GF.body, minHeight: 52, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, paddingHorizontal: 14, fontSize: 17, color: G.ink }} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'monthly'} onClose={() => setSheet(null)} title="Chaque mois" subtitle={mode === 'spend' ? 'la dépense de chaque mois' : 'ce que tu mets de côté chaque mois'}
        footer={<GardenButton label="OK" onPress={() => setSheet(null)} />}>
        <GardenText variant="amount" tabular center>{monthly || (monthlyValue ? String(monthlyValue) : '0')} {CURRENCY_SYMBOL}</GardenText>
        <AmountKeypad value={monthly} onChange={setMonthly} active={sheet === 'monthly'} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'targetDate' || sheet === 'firstDate'} onClose={() => setSheet(null)} title={sheet === 'targetDate' ? 'Objectif atteint avant le…' : 'Première fois le…'}>
        <CalendarWithPicker current={(sheet === 'targetDate' ? targetDate : firstDate) || todayISO()} minDate={sheet === 'targetDate' ? firstDate : todayISO()} maxDate="2060-12-31"
          onDayPress={(d) => { if (sheet === 'targetDate') setTargetDate(d.dateString); else setFirstDate(d.dateString); setSheet(null); setHint(null); }}
          markedDates={{ [(sheet === 'targetDate' ? targetDate : firstDate) || todayISO()]: { selected: true, selectedColor: G.primary, selectedTextColor: G.onPrimary } }}
          accentColor={G.primary} bgColor={G.card} textColor={G.ink} textSecondaryColor={G.muted} />
      </GardenSheet>

      <GardenSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Catégorie des dépenses" subtitle="cherche, choisis, ou crée la tienne">
        <CategoryPicker groups={groups} selectedCategoryId={categoryId} onSelect={(id) => { setCategoryId(id); setSheet(null); setHint(null); }} label="Catégorie" parents={parents}
          onCreateSubcategory={async (n, parentId, icon) => ((await addCategory.mutateAsync({ name: n, type: 'expense', parent_id: parentId, icon })) as any)?.id ?? ''} />
      </GardenSheet>
    </View>
  );
}
