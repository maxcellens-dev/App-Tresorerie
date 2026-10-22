/**
 * SAISIE — le SEUL écran d'ajout d'une dépense, d'une recette ou d'un virement (récurrent ou non).
 * La saisie elle-même est components/transaction/QuickEntry (au tap) ; cet écran lit l'URL, prépare
 * le pré-remplissage et joue les SUITES de l'enregistrement.
 *
 * PARAMÈTRES D'OUVERTURE
 *  • type                  expense | income | transfer
 *  • account               compte source pré-sélectionné (fiche d'un compte)
 *  • to / destType         destination imposée, par compte OU par type de compte (reco épargne / invest)
 *  • amount / label / date valeurs pré-remplies
 *  • preset                tuile « Ce qui revient » (catégorie, libellé, rythme habituel)
 *  • recurring=1           guide de démarrage : une récurrente mensuelle, déjà choisie
 *  • resetPreSaving        virement d'un cumul → remettre ce cumul à 0 une fois le virement passé
 *  • releaseProject        virement d'un montant réservé → libérer les brouillons de réservation
 *  • on_behalf(_name)      saisie au nom d'un membre d'un compte joint
 *  • origin                écran de retour (saisie ouverte depuis un autre onglet)
 *
 * ⚠️ L'écran reste MONTÉ entre deux saisies (on en sort par un `replace` vers un autre onglet) :
 * la saisie est donc remontée NEUVE à chaque arrivée (`entryKey`), avec le pré-remplissage de l'URL
 * du moment — sinon une saisie abandonnée réapparaissait à la suivante.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts } from '../../../hooks/data/useAccounts';
import { useAddCategory, useCategories } from '../../../hooks/data/useCategories';
import { useAllTransactions, useReleaseReservedByProject } from '../../../hooks/data/useTransactions';
import { useProjects } from '../../../hooks/data/useProjects';
import { useProjectAttach } from '../../../hooks/data/useProjectAttach';
import { useResetPreSaving } from '../../../hooks/data/usePreSavings';
import { useQuickSave, type QuickTx } from '../../../hooks/data/useQuickSave';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenGlow from '../../../components/garden/GardenGlow';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import QuickEntry, { type QuickInitial, type QuickKind } from '../../../components/transaction/QuickEntry';
import { RECURRING_PRESETS, presetCategory } from '../../../lib/finance/recurringPresets';
import { sanitizeAmountInput } from '../../../lib/ui/amountInput';
import { safeInternalRoute } from '../../../lib/ui/navHistory';
import { pageColumn } from '../../../lib/ui/webLayout';
import { todayISO } from '../../../lib/dateUtils';
import { GARDEN_COLORS } from '../../../lib/garden/theme';
import type { PreSavingType, Project } from '../../../types/database';

function AddTransactionScreen() {
  const COLORS = useAppColors();
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const params = useLocalSearchParams<{
    type?: string; account?: string; to?: string; destType?: string;
    amount?: string; label?: string; date?: string; preset?: string;
    resetPreSaving?: string; releaseProject?: string;
    on_behalf?: string; on_behalf_name?: string; origin?: string; recurring?: string;
  }>();
  const { user } = useAuth();
  // Comptes où je peux ÉCRIRE (perso + joints + partagés écriture) — pas les comptes en consultation.
  const { data: allAccounts = [] } = useAllAccounts(user?.id);
  const accounts = useMemo(() => allAccounts.filter((a) => a._role !== 'read'), [allAccounts]);
  const { data: categories = [] } = useCategories(user?.id);
  const { data: transactions = [] } = useAllTransactions(user?.id);
  const { data: projects = [] } = useProjects(user?.id);
  const addCategory = useAddCategory(user?.id);
  const attachToProject = useProjectAttach(user?.id);
  /* Suites d'un virement venu d'une reco : le cumul « mis de côté » retombe à zéro une fois viré,
     et un montant réservé pour un projet libère ses brouillons de réservation. Sans elles, l'argent
     restait compté deux fois — une fois réservé, une fois viré. */
  const resetPreSaving = useResetPreSaving(user?.id);
  const releaseReserved = useReleaseReservedByProject(user?.id);
  const save = useQuickSave();

  const [kind, setKind] = useState<QuickKind>('expense');
  const [entryKey, setEntryKey] = useState(0);
  // Chaque arrivée sur l'écran : type de l'URL, saisie neuve.
  useFocusEffect(useCallback(() => {
    const t = params.type;
    setKind(t === 'income' || t === 'transfer' ? t : 'expense');
    setEntryKey((k) => k + 1);
  }, [params.type, params.account, params.to, params.destType, params.amount, params.label, params.date, params.preset, params.recurring, params.on_behalf]));

  /**
   * Compte à pré-sélectionner : celui d'où l'on vient (`account`), sinon le compte courant PAR
   * DÉFAUT (migration 146), sinon le 1er compte courant PERSO (jamais un joint ni un partagé reçu).
   */
  const defaultAccountId = useMemo((): string => {
    if (!accounts.length) return '';
    if (params.account && accounts.some((a) => a.id === params.account)) return String(params.account);
    const preferred = accounts.find((a) => a.is_default);
    if (preferred) return preferred.id;
    const perso = accounts.filter((a) => a.type === 'checking' && a._role === 'owner' && !a.is_joint);
    if (perso.length) return perso[0].id;
    const checking = accounts.filter((a) => a.type === 'checking');
    return checking.length ? checking[0].id : accounts[0].id;
  }, [accounts, params.account]);

  // Avancement (%) des projets, calculé LOCALEMENT depuis le cache des transactions (même formule
  // que le pilotage : Σ |débits| validés passés ÷ cible) — sans le lourd pilotage_data ici.
  const progressPctById = useMemo(() => {
    const today = todayISO();
    const contributed: Record<string, number> = {};
    for (const t of transactions as any[]) {
      if (!t.project_id || t.is_draft || t.date > today || Number(t.amount) >= 0) continue;
      contributed[t.project_id] = (contributed[t.project_id] ?? 0) + Math.abs(Number(t.amount));
    }
    const m: Record<string, number> = {};
    for (const p of projects) {
      const target = Number(p.target_amount) || 0;
      m[p.id] = target > 0 ? Math.min(100, ((contributed[p.id] ?? 0) / target) * 100) : 0;
    }
    return m;
  }, [transactions, projects]);

  // Pré-remplissage : tuile « Ce qui revient », guide (récurrente mensuelle), reco ou fiche de compte.
  const preset = params.preset ? RECURRING_PRESETS.find((p) => p.key === params.preset) : undefined;
  const initial: QuickInitial = {
    amount: params.amount != null ? sanitizeAmountInput(String(params.amount)) : undefined,
    note: params.label != null ? String(params.label) : preset?.note,
    date: params.date ? String(params.date) : undefined,
    categoryId: preset ? presetCategory(preset, categories)?.id : undefined,
    recurrence: preset ? preset.recurrence : params.recurring === '1' ? 'monthly' : null,
    toAccountId: params.to ? String(params.to) : undefined,
  };
  const onBehalfName = params.on_behalf ? (params.on_behalf_name ? decodeURIComponent(String(params.on_behalf_name)) : 'ce membre') : undefined;

  /* Retour : écran d'ORIGINE (bouton « + », fiche de compte, reco), sinon l'écran précédent. Chemin
     INTERNE uniquement (cf. safeInternalRoute) : le paramètre vient de l'URL, donc de n'importe qui
     sur le web — une page de connexion imitée n'aurait plus qu'à se présenter. */
  const leave = useCallback(() => {
    const back = safeInternalRoute(params.origin ? decodeURIComponent(String(params.origin)) : null);
    if (back) router.replace(back as any); else router.back();
  }, [router, params.origin]);

  const submit = async (tx: QuickTx, attached: Project | null) => {
    const today = todayISO();
    const accumulatedBefore = attached ? ((progressPctById[attached.id] ?? 0) / 100) * Number(attached.target_amount) : 0;
    const isTransfer = !!tx.toAccountId;
    const started = await save({
      ...tx,
      onBehalfMemberId: params.on_behalf || null,
      after: async (insertedIds) => {
        if (isTransfer && !tx.isDraft) {
          if (params.resetPreSaving) await resetPreSaving.mutateAsync(String(params.resetPreSaving) as PreSavingType);
          if (params.releaseProject) await releaseReserved.mutateAsync(String(params.releaseProject));
        }
        // Projet : mensualité recalculée + échéance du mois remplacée (best-effort).
        if (attached) {
          void attachToProject({
            project: attached, amount: Math.abs(tx.amount), date: tx.date, accumulatedBefore,
            validated: !tx.isDraft && tx.date <= today, insertedIds,
          }).catch(() => {});
        }
      },
    });
    if (started) leave();
  };

  const title = preset ? preset.label : kind === 'transfer' ? 'Nouveau virement' : kind === 'income' ? 'Nouvelle recette' : 'Nouvelle dépense';

  return (
    <View style={{ flex: 1, backgroundColor: GARDEN_COLORS.bg }}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <GardenGlow />
      <SafeAreaView style={[{ flex: 1 }, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title={title} onBack={leave} />
        {user ? (
          <QuickEntry
            // Les catégories arrivent parfois après l'écran : la tuile pré-choisie (preset) attend leur chargement.
            key={`${entryKey}|${preset && categories.length ? 'cats' : ''}`}
            kind={kind}
            onKind={setKind}
            accounts={accounts as any}
            defaultAccountId={defaultAccountId}
            categories={categories}
            transactions={transactions as any}
            projects={projects}
            progressPctById={progressPctById}
            initial={initial}
            destType={params.destType ? String(params.destType) : undefined}
            onBehalfName={onBehalfName}
            onCreateCategory={async (name, parentId, icon, type) => {
              const created = await addCategory.mutateAsync({ name, type, parent_id: parentId, icon });
              return (created as any)?.id ?? '';
            }}
            onSubmit={submit}
          />
        ) : null}
      </SafeAreaView>
      <CalculatorButton page="transactions" />
    </View>
  );
}

export default withDeferredMount(AddTransactionScreen);
