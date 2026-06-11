import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ScreenGradient from './ScreenGradient';
import HeaderWithProfile from './HeaderWithProfile';
import CalendarWithPicker from './CalendarWithPicker';
import { useAuth } from '../contexts/AuthContext';
import { useProjects, useAddProject, useUpdateProject, useDeleteProjectFull, useDeleteProjectKeepingLocked, useCheckProjectTransactions } from '../hooks/useProjects';
import { useAccounts } from '../hooks/useAccounts';
import { useProfile } from '../hooks/useProfile';
import { useMonthlyClosure } from '../hooks/useMonthlyClosure';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';


type AllocationType = 'monthly' | 'date' | 'ponctuel';

interface PonctuelEntry {
  enabled: boolean;
  amount: string;
}

interface FormState {
  name: string;
  description: string;
  target_amount: string;
  allocation_type: AllocationType;
  monthly_allocation: string;
  target_date: string;
  source_account_id: string | null;
  linked_account_id: string | null;
  first_payment_date: string;
  current_accumulated: number;
}

function getNext12Months(): { key: string; label: string; dayOne: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const dayOne = `${key}-01`;
    result.push({ key, label, dayOne });
  }
  return result;
}

export default function AddProjectModal() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { data: projects = [] } = useProjects(user?.id || '');
  const isEdit = !!params.id;
  const editingProject: Project | null = useMemo(
    () => (params.id ? projects.find((p) => p.id === params.id) ?? null : null),
    [projects, params.id]
  );
  const addProjectMutation = useAddProject(user?.id || '');
  const updateProjectMutation = useUpdateProject(user?.id || '');
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(user?.id || '');

  const months12 = useMemo(() => getNext12Months(), []);
  const currentMonthKey = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    target_amount: '',
    allocation_type: 'monthly',
    monthly_allocation: '',
    target_date: '',
    source_account_id: null,
    linked_account_id: null,
    first_payment_date: '',
    current_accumulated: 0,
  });

  // ponctuelEntries: key YYYY-MM → { enabled, amount }
  const [ponctuelEntries, setPonctuelEntries] = useState<Record<string, PonctuelEntry>>({});
  // Jour du mois où les virements ponctuels sont générés (1-31, clampé selon le mois)
  const [ponctuelDay, setPonctuelDay] = useState('1');

  // Construit la date d'un mois ponctuel au jour choisi (clampé au dernier jour du mois)
  const ponctuelDateFor = (key: string): string => {
    const [y, m] = key.split('-').map(Number);
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(Math.max(1, parseInt(ponctuelDay) || 1), maxDay);
    return `${key}-${String(day).padStart(2, '0')}`;
  };

  const [showAccountPicker, setShowAccountPicker] = useState<'source' | 'destination' | null>(null);
  const [showCalendar, setShowCalendar] = useState<'target' | 'payment' | false>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  // Assistant en étapes (création uniquement) : 1) infos 2) planification/dates 3) comptes.
  // En modification, tout reste sur un seul écran.
  const [step, setStep] = useState(1);
  const wizard = !isEdit;

  // Deletion state
  const deleteFullMutation = useDeleteProjectFull(user?.id || '');
  const deleteKeepingLockedMutation = useDeleteProjectKeepingLocked(user?.id || '');
  const { check: checkTransactions } = useCheckProjectTransactions(user?.id || '');
  const { data: profile } = useProfile(user?.id);
  const { lockDate: closureLock } = useMonthlyClosure(user?.id);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    title: string;
    message: string;
    options: Array<{ label: string; action: () => void; destructive?: boolean }>;
  } | null>(null);
  // Allocation mensuelle : auto-calculée depuis le montant cible tant que l'utilisateur ne l'a pas modifiée.
  const [monthlyAllocEdited, setMonthlyAllocEdited] = useState(false);

  // Initialisation : en édition, on attend que le projet soit chargé pour pré-remplir (1 seule fois).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (isEdit) {
      if (!editingProject) return; // attendre le chargement de la liste
      initializedRef.current = true;
      setMonthlyAllocEdited(true); // en édition, on ne réécrase pas l'allocation existante
      const allocType: AllocationType = (editingProject.allocation_type as AllocationType) || (editingProject.target_date ? 'date' : 'monthly');
      setForm({
        name: editingProject.name || '',
        description: editingProject.description || '',
        target_amount: editingProject.target_amount?.toString() || '',
        allocation_type: allocType,
        monthly_allocation: editingProject.monthly_allocation?.toString() || '',
        target_date: editingProject.target_date || '',
        source_account_id: editingProject.source_account_id || null,
        linked_account_id: editingProject.linked_account_id || null,
        first_payment_date: editingProject.first_payment_date || (editingProject.transaction_day ? (() => { const d = new Date(); d.setDate(editingProject.transaction_day!); return d.toISOString().slice(0, 10); })() : ''),
        current_accumulated: editingProject.current_accumulated || 0,
      });

      // Si ponctuel : charger les transactions existantes
      if (allocType === 'ponctuel' && supabase) {
        supabase
          .from('transactions')
          .select('date, amount')
          .eq('project_id', editingProject.id)
          .lt('amount', 0)
          .order('date', { ascending: true })
          .then(({ data: txns }) => {
            if (!txns) return;
            const entries: Record<string, PonctuelEntry> = {};
            for (const t of txns) {
              const key = t.date.slice(0, 7); // YYYY-MM
              entries[key] = { enabled: true, amount: Math.abs(Number(t.amount)).toString() };
            }
            setPonctuelEntries(entries);
            // Déduire le jour du mois depuis la première transaction
            if (txns.length > 0) setPonctuelDay(String(Number(txns[0].date.slice(8, 10)) || 1));
          });
      } else {
        setPonctuelEntries({});
      setPonctuelDay('1');
      }
    } else {
      initializedRef.current = true;
      setStep(1);
      setFormError(null);
      setErrorFields([]);
    }
  }, [isEdit, editingProject]);

  // Mode « mensuel » : suggère automatiquement l'allocation = montant cible / 12 mois,
  // tant que l'utilisateur n'a pas saisi sa propre valeur (il peut toujours la modifier).
  const DEFAULT_PROJECT_MONTHS = 12;
  useEffect(() => {
    if (monthlyAllocEdited || form.allocation_type !== 'monthly') return;
    const target = parseFloat(form.target_amount);
    if (!(target > 0)) return;
    const suggested = String(Math.max(1, Math.ceil(target / DEFAULT_PROJECT_MONTHS)));
    if (suggested !== form.monthly_allocation) setForm((f) => ({ ...f, monthly_allocation: suggested }));
  }, [form.target_amount, form.allocation_type, monthlyAllocEdited]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculatedAllocation = useMemo(() => {
    if (form.allocation_type !== 'date' || !form.target_date || !form.target_amount) return null;
    const targetAmount = parseFloat(form.target_amount);
    const amountToAccumulate = Math.max(0, targetAmount - form.current_accumulated);
    const startDate = form.first_payment_date || new Date().toISOString().slice(0, 10);
    const endLimit = new Date(form.target_date + 'T23:59:59');
    // Count payment months using same cursor logic as the delete recalculation
    const cursor = new Date(startDate + 'T00:00:00');
    if (cursor > endLimit) return null;
    let monthsLeft = 0;
    const c = new Date(cursor);
    while (c <= endLimit) { monthsLeft++; c.setMonth(c.getMonth() + 1); }
    monthsLeft = Math.max(1, monthsLeft);
    return amountToAccumulate / monthsLeft;
  }, [form.allocation_type, form.target_date, form.target_amount, form.current_accumulated, form.first_payment_date]);

  const ponctuelTotal = useMemo(() => {
    return Object.values(ponctuelEntries).reduce((sum, e) => {
      if (e?.enabled && e.amount) return sum + (parseFloat(e.amount) || 0);
      return sum;
    }, 0);
  }, [ponctuelEntries]);

  // Mois affichés dans le tableau ponctuel = mois PASSÉS déjà saisis (lecture seule, grisés)
  // + les 12 mois à partir du mois courant (modifiables).
  const ponctuelDisplayMonths = useMemo(() => {
    const past = Object.keys(ponctuelEntries)
      .filter((k) => k < currentMonthKey)
      .sort()
      .map((k) => {
        const [y, m] = k.split('-').map(Number);
        return {
          key: k,
          label: new Date(y, m - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          dayOne: `${k}-01`,
          isPast: true,
        };
      });
    return [...past, ...months12.map((m) => ({ ...m, isPast: false }))];
  }, [ponctuelEntries, currentMonthKey, months12]);

  const togglePonctuelMonth = (key: string) => {
    setPonctuelEntries((prev) => {
      const cur = prev[key];
      if (cur?.enabled) {
        return { ...prev, [key]: { enabled: false, amount: cur.amount } };
      }
      return { ...prev, [key]: { enabled: true, amount: cur?.amount || '' } };
    });
  };

  const setPonctuelAmount = (key: string, value: string) => {
    setPonctuelEntries((prev) => ({
      ...prev,
      [key]: { enabled: prev[key]?.enabled ?? true, amount: value.replace(/[^0-9.]/g, '') },
    }));
  };

  // Validation d'une étape de l'assistant. Renvoie true si l'étape est valide.
  const validateStep = (s: number): boolean => {
    setFormError(null);
    setErrorFields([]);
    if (s === 1) {
      if (!form.name.trim()) { setFormError('Le nom du projet est obligatoire.'); setErrorFields(['name']); return false; }
      if (!form.target_amount.trim() || isNaN(parseFloat(form.target_amount))) { setFormError('Le montant cible est obligatoire.'); setErrorFields(['target_amount']); return false; }
      return true;
    }
    if (s === 2) {
      if (form.allocation_type === 'monthly') {
        if (!form.monthly_allocation.trim()) { setFormError("L'allocation mensuelle est obligatoire."); setErrorFields(['monthly_allocation']); return false; }
      } else if (form.allocation_type === 'date') {
        if (!form.target_date || !calculatedAllocation) { setFormError('Veuillez entrer une date cible valide.'); setErrorFields(['target_date']); return false; }
      } else {
        const anyEnabled = Object.values(ponctuelEntries).some((e) => e?.enabled && parseFloat(e.amount || '0') > 0);
        if (!anyEnabled) { setFormError('Veuillez activer au moins un mois avec un montant.'); return false; }
      }
      return true;
    }
    return true;
  };

  const goNext = () => { if (validateStep(step)) setStep((s) => Math.min(3, s + 1)); };
  const goPrev = () => { setFormError(null); setErrorFields([]); setStep((s) => Math.max(1, s - 1)); };

  const handleSubmit = async () => {
    setFormError(null);
    setErrorFields([]);

    if (!form.name.trim()) {
      setFormError('Le nom du projet est obligatoire.');
      setErrorFields(['name']);
      return;
    }
    if (!form.target_amount.trim() || isNaN(parseFloat(form.target_amount))) {
      setFormError('Le montant cible est obligatoire.');
      setErrorFields(['target_amount']);
      return;
    }
    if (!form.source_account_id) {
      setFormError('Veuillez sélectionner un compte source.');
      setErrorFields(['source_account']);
      return;
    }
    if (!form.linked_account_id) {
      setFormError('Veuillez sélectionner un compte de destination.');
      setErrorFields(['linked_account']);
      return;
    }

    let monthlyAlloc = 0;
    let ponctuelList: { date: string; amount: number }[] | undefined;

    if (form.allocation_type === 'monthly') {
      if (!form.monthly_allocation.trim()) {
        setFormError("L'allocation mensuelle est obligatoire.");
        setErrorFields(['monthly_allocation']);
        return;
      }
      monthlyAlloc = parseFloat(form.monthly_allocation);
    } else if (form.allocation_type === 'date') {
      if (!form.target_date || !calculatedAllocation) {
        setFormError('Veuillez entrer une date cible valide.');
        setErrorFields(['target_date']);
        return;
      }
      monthlyAlloc = calculatedAllocation;
    } else {
      // ponctuel — ne régénérer que le mois courant + futurs (les mois passés sont préservés)
      ponctuelList = Object.keys(ponctuelEntries)
        .filter((k) => k >= currentMonthKey && ponctuelEntries[k]?.enabled && parseFloat(ponctuelEntries[k]?.amount || '0') > 0)
        .sort()
        .map((k) => ({ date: ponctuelDateFor(k), amount: parseFloat(ponctuelEntries[k].amount) }));
      const anyEnabled = Object.values(ponctuelEntries).some((e) => e?.enabled && parseFloat(e.amount || '0') > 0);
      if (!anyEnabled) {
        setFormError('Veuillez activer au moins un mois avec un montant.');
        return;
      }
      monthlyAlloc = ponctuelList.length > 0 ? ponctuelList.reduce((s, e) => s + e.amount, 0) / ponctuelList.length : 0;
    }

    const resetForm = () => {
      // Succès : la liste se rafraîchit via l'invalidation des requêtes, on revient à l'écran précédent.
      router.back();
    };

    if (editingProject) {
      updateProjectMutation.mutate(
        {
          id: editingProject.id,
          name: form.name,
          description: form.description || undefined,
          target_amount: parseFloat(form.target_amount),
          monthly_allocation: monthlyAlloc,
          allocation_type: form.allocation_type,
          target_date: form.allocation_type === 'date' ? form.target_date : null,
          current_accumulated: form.current_accumulated,
          source_account_id: form.source_account_id,
          linked_account_id: form.linked_account_id,
          transaction_day: form.first_payment_date ? new Date(form.first_payment_date).getDate() : 1,
          first_payment_date: form.first_payment_date || undefined,
          ponctuel_entries: ponctuelList,
        },
        { onSuccess: resetForm }
      );
    } else {
      addProjectMutation.mutate(
        {
          name: form.name,
          description: form.description || undefined,
          target_amount: parseFloat(form.target_amount),
          monthly_allocation: monthlyAlloc,
          allocation_type: form.allocation_type,
          target_date: form.allocation_type === 'date' ? form.target_date : undefined,
          current_accumulated: form.current_accumulated,
          source_account_id: form.source_account_id || undefined,
          linked_account_id: form.linked_account_id || undefined,
          transaction_day: form.first_payment_date ? new Date(form.first_payment_date).getDate() : 1,
          first_payment_date: form.first_payment_date || undefined,
          ponctuel_entries: ponctuelList,
        },
        { onSuccess: resetForm }
      );
    }
  };

  const handleClose = () => {
    setForm({ name: '', description: '', target_amount: '', allocation_type: 'monthly', monthly_allocation: '', target_date: '', source_account_id: null, linked_account_id: null, first_payment_date: '', current_accumulated: 0 });
    setPonctuelEntries({});
    setShowAccountPicker(null);
    setShowCalendar(false);
    setFormError(null);
    setErrorFields([]);
    setStep(1);
    setShowDeleteConfirm(false);
    router.back();
  };

  const runDeleteFull = () => {
    if (!editingProject) return;
    setDeleteConfirmState(null);
    deleteFullMutation.mutate(editingProject.id, {
      onSuccess: () => { handleClose(); },
      onError: () => Alert.alert('Erreur', 'La suppression du projet a échoué.'),
    });
  };

  const runDeleteKeepingLocked = (lockDate: string) => {
    if (!editingProject) return;
    setDeleteConfirmState(null);
    deleteKeepingLockedMutation.mutate(
      { projectId: editingProject.id, lockDate },
      {
        onSuccess: () => { handleClose(); },
        onError: () => Alert.alert('Erreur', 'La suppression du projet a échoué.'),
      },
    );
  };

  const buildDeleteSummary = (opts: {
    projectName: string;
    kept?: number;
    removedPast?: number;
    removedFuture?: number;
  }) => {
    const lines = [`Projet « ${opts.projectName} »`, ''];
    if (opts.kept && opts.kept > 0) {
      lines.push('✓ Conservé dans vos comptes :');
      lines.push(`  • ${opts.kept} transaction(s) clôturée(s) (détachées du projet)`);
      lines.push('');
    }
    lines.push('✗ Sera supprimé :');
    lines.push('  • Le projet');
    if (opts.removedPast && opts.removedPast > 0) {
      lines.push(`  • ${opts.removedPast} transaction(s) passée(s)`);
    }
    if (opts.removedFuture && opts.removedFuture > 0) {
      lines.push(`  • ${opts.removedFuture} virement(s) planifié(s) à venir`);
    }
    if (!opts.removedPast && !opts.removedFuture) {
      lines.push('  • Aucune transaction liée');
    }
    lines.push('', 'Cette action est irréversible.');
    return lines.join('\n');
  };

  const handleDelete = async () => {
    if (!editingProject) return;
    try {
      const { past, future } = await checkTransactions(editingProject.id);
      const closureLockDate = closureLock;
      const lockedTxns = closureLockDate ? past.filter((t: any) => t.date <= closureLockDate) : [];
      const unlockedPastTxns = closureLockDate ? past.filter((t: any) => t.date > closureLockDate) : past;
      const futureCount = future.length;

      if (lockedTxns.length > 0 && unlockedPastTxns.length === 0 && futureCount === 0) {
        setDeleteConfirmState({
          title: 'Suppression impossible',
          message: `Le projet « ${editingProject.name} » compte ${lockedTxns.length} transaction(s) dans une période clôturée.\n\nCes écritures ne peuvent pas être effacées. Rouvrez la période concernée dans le Pilotage si vous souhaitez tout supprimer.`,
          options: [{ label: 'Compris', action: () => setDeleteConfirmState(null) }],
        });
        return;
      }

      if (lockedTxns.length > 0 && closureLockDate && (unlockedPastTxns.length > 0 || futureCount > 0)) {
        setDeleteConfirmState({
          title: 'Supprimer le projet ?',
          message: buildDeleteSummary({
            projectName: editingProject.name,
            kept: lockedTxns.length,
            removedPast: unlockedPastTxns.length,
            removedFuture: futureCount,
          }),
          options: [
            { label: 'Annuler', action: () => setDeleteConfirmState(null) },
            {
              label: 'Oui, supprimer',
              destructive: true,
              action: () => runDeleteKeepingLocked(closureLockDate),
            },
          ],
        });
        return;
      }

      setDeleteConfirmState({
        title: 'Supprimer le projet ?',
        message: buildDeleteSummary({
          projectName: editingProject.name,
          removedPast: past.length,
          removedFuture: futureCount,
        }),
        options: [
          { label: 'Annuler', action: () => setDeleteConfirmState(null) },
          { label: 'Oui, supprimer', destructive: true, action: runDeleteFull },
        ],
      });
    } catch (err) {
      setDeleteConfirmState({
        title: 'Erreur',
        message: 'Impossible de vérifier les transactions du projet.',
        options: [
          {
            label: 'Fermer',
            action: () => setDeleteConfirmState(null),
          },
        ],
      });
    }
  };

  const formatDateFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-');
      return `${day}-${month}-${year}`;
    } catch { return dateStr; }
  };

  const parseDateFromFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const cleaned = dateStr.replace(/\D/g, '');
      if (cleaned.length === 8) {
        const day = cleaned.substring(0, 2);
        const month = cleaned.substring(2, 4);
        const year = cleaned.substring(4, 8);
        const date = new Date(`${year}-${month}-${day}`);
        if (isNaN(date.getTime())) return '';
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (date < today) return '';
        return `${year}-${month}-${day}`;
      }
    } catch { return ''; }
    return '';
  };

  const getTodayDateString = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  const selectedSourceAccount = accounts.find((acc) => acc.id === form.source_account_id);
  const selectedAccount = accounts.find((acc) => acc.id === form.linked_account_id);
  const isPending = addProjectMutation.isPending || updateProjectMutation.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <HeaderWithProfile
          title={isEdit ? 'Modifier le projet' : 'Nouveau projet'}
          showBack
          hideProfile
          onBack={handleClose}
        />
        {isEdit && !editingProject ? (
          <View style={styles.loadingContainer}><ActivityIndicator color={COLORS.primary} /></View>
        ) : (
          <View style={styles.pageBody}>
            {!showAccountPicker ? (
              <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
                {/* Bandeau erreur */}
                {formError && (
                  <View style={[styles.errorBanner, { borderColor: COLORS.danger + '66', backgroundColor: COLORS.danger + '1F' }]}>
                    <Text style={styles.errorBannerText}>{formError}</Text>
                  </View>
                )}
                {wizard && (
                  <View style={styles.stepIndicator}>
                    {[1, 2, 3].map((n, i) => (
                      <React.Fragment key={n}>
                        <View style={[styles.stepDot, step >= n && styles.stepDotActive]}>
                          <Text style={[styles.stepDotText, step >= n && styles.stepDotTextActive]}>{n}</Text>
                        </View>
                        {i < 2 && <View style={[styles.stepLine, step > n && styles.stepLineActive]} />}
                      </React.Fragment>
                    ))}
                  </View>
                )}
                {wizard && (
                  <Text style={styles.stepTitle}>
                    {step === 1 ? 'Informations du projet' : step === 2 ? 'Planification & dates' : 'Comptes des mouvements'}
                  </Text>
                )}

                {(!wizard || step === 1) && (<>
                {/* Nom */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Nom du projet *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: errorFields.includes('name') ? COLORS.danger : COLORS.border }]}
                    placeholder="Ex. Nouvelle voiture"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.name}
                    onChangeText={(t) => { setForm({ ...form, name: t }); setErrorFields((p) => p.filter((f) => f !== 'name')); setFormError(null); }}
                    editable={!isPending}
                  />
                </View>

                {/* Description */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Description (optionnel)</Text>
                  <TextInput
                    style={[styles.textarea, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                    placeholder="Détails du projet"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.description}
                    onChangeText={(t) => setForm({ ...form, description: t })}
                    multiline
                    numberOfLines={2}
                    editable={!isPending}
                  />
                </View>

                {/* Montant cible */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Montant cible ({CURRENCY_SYMBOL}) *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                    placeholder="10000"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.target_amount}
                    onChangeText={(t) => setForm({ ...form, target_amount: t.replace(/[^0-9.]/g, '') })}
                    keyboardType="decimal-pad"
                    editable={!isPending}
                  />
                </View>

                </>)}

                {(!wizard || step === 2) && (<>
                {/* Planification — 3 onglets */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Planification</Text>
                  <View style={styles.toggleGroup}>
                    {(['monthly', 'date', 'ponctuel'] as AllocationType[]).map((type) => {
                      const labels = { monthly: 'Mensuel', date: 'Date cible', ponctuel: 'Ponctuel' };
                      const active = form.allocation_type === type;
                      return (
                        <TouchableOpacity
                          key={type}
                          style={[styles.toggleButton, active && { backgroundColor: COLORS.primary + '30', borderColor: COLORS.primary }]}
                          onPress={() => setForm({ ...form, allocation_type: type })}
                        >
                          <Text style={[styles.toggleText, { color: active ? COLORS.primary : COLORS.text }]}>
                            {labels[type]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Mensuel */}
                {form.allocation_type === 'monthly' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>Allocation mensuelle ({CURRENCY_SYMBOL}) *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                      placeholder="500"
                      placeholderTextColor={COLORS.textSecondary}
                      value={form.monthly_allocation}
                      onChangeText={(t) => { setMonthlyAllocEdited(true); setForm({ ...form, monthly_allocation: t.replace(/[^0-9.]/g, '') }); }}
                      keyboardType="decimal-pad"
                      editable={!isPending}
                    />
                    <Text style={[styles.label, { color: COLORS.textSecondary, fontSize: 12, marginTop: 6, fontWeight: '400' }]}>
                      {monthlyAllocEdited
                        ? 'Vous fixez vous-même le montant mensuel.'
                        : `Calculé automatiquement (objectif sur ${DEFAULT_PROJECT_MONTHS} mois) — modifiable.`}
                    </Text>
                  </View>
                )}

                {/* Date cible */}
                {form.allocation_type === 'date' && (
                  <>
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: COLORS.text }]}>Date cible (jj-mm-aaaa) *</Text>
                      <View style={styles.dateInputContainer}>
                        <TextInput
                          style={[styles.input, styles.dateTextInput, { backgroundColor: COLORS.background, borderColor: COLORS.border, color: COLORS.text }]}
                          placeholder="jj-mm-aaaa"
                          placeholderTextColor={COLORS.textSecondary}
                          value={form.target_date ? formatDateFrench(form.target_date) : ''}
                          onChangeText={(t) => {
                            const p = parseDateFromFrench(t);
                            if (p) setForm({ ...form, target_date: p });
                            else if (t === '') setForm({ ...form, target_date: '' });
                          }}
                          editable={!isPending}
                        />
                        <TouchableOpacity
                          style={[styles.calendarButton, { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary }]}
                          onPress={() => setShowCalendar('target')}
                          disabled={isPending}
                        >
                          <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {calculatedAllocation !== null && (
                      <View style={[styles.field, { backgroundColor: COLORS.background, padding: 12, borderRadius: 8 }]}>
                        <Text style={[styles.label, { color: COLORS.primary }]}>Allocation calculée</Text>
                        <Text style={[styles.calculatedAmount, { color: COLORS.primary }]}>
                          {calculatedAllocation.toFixed(2)} {CURRENCY_SYMBOL}/mois
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Ponctuel */}
                {form.allocation_type === 'ponctuel' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>Jour du mois des virements</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.input, { flex: 1, backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                        placeholder="1"
                        placeholderTextColor={COLORS.textSecondary}
                        value={ponctuelDay}
                        onChangeText={(t) => {
                          const clean = t.replace(/[^0-9]/g, '');
                          if (clean === '') { setPonctuelDay(''); return; }
                          const n = Math.min(31, Math.max(1, parseInt(clean)));
                          setPonctuelDay(String(n));
                        }}
                        keyboardType="number-pad"
                        maxLength={2}
                        editable={!isPending}
                      />
                      <Text style={{ color: COLORS.textSecondary, fontSize: 13, paddingHorizontal: 4 }}>du mois</Text>
                    </View>
                    <Text style={[styles.label, { color: COLORS.text, marginTop: 12 }]}>Apports par mois</Text>
                    <View style={[styles.ponctuelContainer, { backgroundColor: COLORS.background, borderColor: COLORS.border }]}>
                      {ponctuelDisplayMonths.map((m, idx) => {
                        const entry = ponctuelEntries[m.key];
                        const enabled = entry?.enabled ?? false;
                        const isPast = (m as any).isPast;
                        return (
                          <View
                            key={m.key}
                            style={[
                              styles.ponctuelRow,
                              idx < ponctuelDisplayMonths.length - 1 && { borderBottomWidth: 1, borderBottomColor: COLORS.border },
                              isPast && { opacity: 0.55 },
                            ]}
                          >
                            <TouchableOpacity
                              style={styles.ponctuelToggle}
                              onPress={() => !isPast && togglePonctuelMonth(m.key)}
                              activeOpacity={isPast ? 1 : 0.7}
                              disabled={isPast}
                            >
                              {isPast ? (
                                <Ionicons name="lock-closed" size={14} color={COLORS.textSecondary} />
                              ) : (
                                <View style={[styles.ponctuelDot, enabled && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}>
                                  {enabled && <View style={styles.ponctuelDotInner} />}
                                </View>
                              )}
                            </TouchableOpacity>
                            <Text style={[styles.ponctuelLabel, { color: enabled ? COLORS.text : COLORS.textSecondary }]}>
                              {m.label}{isPast ? ' · passé' : ''}
                            </Text>
                            {isPast ? (
                              <Text style={[styles.ponctuelInput, { color: COLORS.textSecondary, borderColor: 'transparent', textAlign: 'right' }]}>
                                {enabled && entry?.amount ? `${entry.amount} ${CURRENCY_SYMBOL}` : '–'}
                              </Text>
                            ) : enabled ? (
                              <TextInput
                                style={[styles.ponctuelInput, { color: COLORS.blue, borderColor: COLORS.blue + '60' }]}
                                placeholder="0"
                                placeholderTextColor={COLORS.textSecondary}
                                value={entry?.amount || ''}
                                onChangeText={(v) => setPonctuelAmount(m.key, v)}
                                keyboardType="decimal-pad"
                                editable={!isPending}
                              />
                            ) : (
                              <Text style={styles.ponctuelDash}>–</Text>
                            )}
                          </View>
                        );
                      })}
                      {/* Total */}
                      <View style={[styles.ponctuelTotal, { borderTopColor: COLORS.border }]}>
                        <Text style={[styles.ponctuelTotalLabel, { color: COLORS.textSecondary }]}>Total apports</Text>
                        <Text style={[styles.ponctuelTotalAmount, { color: COLORS.blue }]}>
                          {ponctuelTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                </>)}

                {(!wizard || step === 3) && (<>
                {/* Message d'information sur les brouillons générés */}
                {!editingProject && (
                  <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary + '40' }]}>
                    <Text style={styles.infoIcon}>💡</Text>
                    <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>
                      {form.allocation_type === 'ponctuel'
                        ? 'Chaque montant saisi sera ajouté comme transaction en brouillon à la date prévue.'
                        : 'Chaque versement mensuel sera ajouté comme transaction en brouillon aux dates à venir.'}
                      {' '}Vous pourrez ensuite <Text style={{ fontWeight: '700', color: COLORS.text }}>valider ou ajuster chaque versement un par un</Text> dans l'onglet Transactions, ou tout modifier d'un coup en rouvrant ce projet.
                    </Text>
                  </View>
                )}

                {/* Compte source */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Compte source *</Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: COLORS.background, borderColor: COLORS.border, justifyContent: 'center' }]}
                    onPress={() => setShowAccountPicker('source')}
                    disabled={isPending}
                  >
                    <Text style={[styles.pickerText, { color: selectedSourceAccount ? COLORS.text : COLORS.textSecondary }]}>
                      {selectedSourceAccount ? selectedSourceAccount.name : 'Sélectionner le compte source'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Compte destination */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Compte de destination *</Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: COLORS.background, borderColor: COLORS.border, justifyContent: 'center' }]}
                    onPress={() => setShowAccountPicker('destination')}
                    disabled={isPending}
                  >
                    <Text style={[styles.pickerText, { color: selectedAccount ? COLORS.text : COLORS.textSecondary }]}>
                      {selectedAccount ? selectedAccount.name : 'Sélectionner le compte destination'}
                    </Text>
                  </TouchableOpacity>
                  {/* Note : même compte source = destination → réservation */}
                  {form.source_account_id && form.source_account_id === form.linked_account_id ? (
                    <View style={[styles.accountNote, { backgroundColor: '#60a5fa14', borderColor: '#60a5fa40' }]}>
                      <Text style={styles.accountNoteIcon}>🔒</Text>
                      <Text style={[styles.accountNoteText, { color: COLORS.text }]}>
                        Même compte en source et destination : aucun virement réel. Le montant est mis de côté en <Text style={{ fontWeight: '700', color: '#60a5fa' }}>Réservé</Text> sur ce compte.
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.accountHint, { color: COLORS.textSecondary }]}>
                      Astuce : choisissez le même compte en source et destination pour simplement mettre un montant de côté en « Réservé » (sans virement réel).
                    </Text>
                  )}
                </View>

                </>)}

                {(!wizard || step === 2) && (<>
                {/* Date premier virement (pas pour ponctuel) */}
                {form.allocation_type !== 'ponctuel' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>Date du premier virement</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.input, styles.dateTextInput, { backgroundColor: COLORS.background, borderColor: COLORS.border, color: COLORS.text }]}
                        placeholder="jj-mm-aaaa"
                        placeholderTextColor={COLORS.textSecondary}
                        value={form.first_payment_date ? formatDateFrench(form.first_payment_date) : ''}
                        onChangeText={(t) => {
                          const p = parseDateFromFrench(t);
                          if (p) setForm({ ...form, first_payment_date: p });
                          else if (t === '') setForm({ ...form, first_payment_date: '' });
                        }}
                        editable={!isPending}
                      />
                      <TouchableOpacity
                        style={[styles.calendarButton, { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary }]}
                        onPress={() => setShowCalendar('payment')}
                        disabled={isPending}
                      >
                        <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                </>)}

                {/* Actions — placées sous les champs (comme les écrans Dépense/Recette/Virement) */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton, { borderColor: COLORS.border }]}
                    onPress={wizard && step > 1 ? goPrev : handleClose}
                    disabled={isPending}
                  >
                    <Text style={[styles.buttonText, { color: COLORS.text }]}>{wizard && step > 1 ? 'Précédent' : 'Annuler'}</Text>
                  </TouchableOpacity>
                  {wizard && step < 3 ? (
                    <TouchableOpacity
                      style={[styles.button, { backgroundColor: COLORS.primary }]}
                      onPress={goNext}
                      disabled={isPending}
                    >
                      <Text style={styles.submitButtonText}>Suivant</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.button, { backgroundColor: COLORS.primary }]}
                      onPress={handleSubmit}
                      disabled={isPending}
                    >
                      {isPending ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.submitButtonText}>{editingProject ? 'Mettre à jour' : 'Créer'}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>

                {/* Bouton Supprimer (seulement en édition) */}
                {editingProject && (
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: COLORS.danger + '20', marginTop: 12 }]}
                    onPress={() => { handleDelete(); }}
                    disabled={deleteFullMutation.isPending || deleteKeepingLockedMutation.isPending}
                  >
                    {deleteFullMutation.isPending ? (
                      <ActivityIndicator color={COLORS.danger} />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Ionicons name="trash" size={16} color={COLORS.danger} />
                        <Text style={[styles.submitButtonText, { color: COLORS.danger }]}>Supprimer le projet</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                <View style={{ height: 24 }} />
              </ScrollView>
            ) : (
              /* Account Picker */
              <View style={styles.form}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={() => setShowAccountPicker(null)}>
                    <Text style={[styles.pickerHeaderText, { color: COLORS.primary }]}>Retour</Text>
                  </TouchableOpacity>
                  <Text style={[styles.pickerHeaderTitle, { color: COLORS.text }]}>
                    {showAccountPicker === 'source' ? 'Compte source' : 'Compte destination'}
                  </Text>
                  <View style={{ width: 50 }} />
                </View>
                {accountsLoading ? (
                  <View style={styles.loadingContainer}><ActivityIndicator color={COLORS.primary} /></View>
                ) : (
                  <FlatList
                    data={accounts}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => {
                      const currentId = showAccountPicker === 'source' ? form.source_account_id : form.linked_account_id;
                      const isSelected = item.id === currentId;
                      return (
                        <TouchableOpacity
                          style={[styles.accountOption, { backgroundColor: COLORS.background, borderBottomColor: COLORS.border }, isSelected && { backgroundColor: COLORS.primary + '20' }]}
                          onPress={() => {
                            if (showAccountPicker === 'source') setForm({ ...form, source_account_id: item.id });
                            else setForm({ ...form, linked_account_id: item.id });
                            setShowAccountPicker(null);
                          }}
                        >
                          <View style={styles.accountContent}>
                            <Text style={[styles.accountName, { color: COLORS.text, fontWeight: isSelected ? '600' : '400' }]}>
                              {item.name || 'Compte sans nom'}
                            </Text>
                            <Text style={[styles.accountType, { color: COLORS.textSecondary }]}>{item.type}</Text>
                          </View>
                          {isSelected && <Text style={[styles.checkmark, { color: COLORS.primary }]}>✓</Text>}
                        </TouchableOpacity>
                      );
                    }}
                    scrollEnabled
                  />
                )}
              </View>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Calendar modal */}
      <Modal visible={!!showCalendar} transparent animationType="slide" onRequestClose={() => setShowCalendar(false)}>
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.calendarContainer, { backgroundColor: COLORS.cardSolid, borderColor: COLORS.border }]}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setShowCalendar(false)}>
                <Text style={[styles.calendarHeaderText, { color: COLORS.primary }]}>Fermer</Text>
              </TouchableOpacity>
              <Text style={[styles.calendarTitle, { color: COLORS.text }]}>Sélectionner une date</Text>
              <View style={{ width: 50 }} />
            </View>
            <View style={styles.calendarWrapper}>
              <CalendarWithPicker
                current={showCalendar === 'payment' ? (form.first_payment_date || getTodayDateString()) : (form.target_date || getTodayDateString())}
                maxDate="2050-12-31"
                onDayPress={(day: any) => {
                  if (showCalendar === 'payment') setForm({ ...form, first_payment_date: day.dateString });
                  else setForm({ ...form, target_date: day.dateString });
                  setShowCalendar(false);
                }}
                markedDates={(() => {
                  const dateStr = showCalendar === 'payment' ? form.first_payment_date : form.target_date;
                  if (!dateStr) return {};
                  return { [dateStr]: { selected: true, selectedColor: COLORS.primary, selectedTextColor: '#000' } };
                })()}
                accentColor={COLORS.primary}
                bgColor={COLORS.cardSolid}
                textColor={COLORS.text}
                textSecondaryColor={COLORS.textSecondary}
                style={styles.calendar}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={!!deleteConfirmState} transparent animationType="fade">
        <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', paddingHorizontal: 20 }]}>
          <View style={[styles.confirmBox, { backgroundColor: COLORS.cardSolid }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="warning" size={20} color={COLORS.danger} />
              <Text style={[styles.confirmTitle, { color: COLORS.text, marginBottom: 0, flex: 1 }]}>{deleteConfirmState?.title}</Text>
            </View>
            <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>{deleteConfirmState?.message}</Text>
            <View style={styles.confirmButtonGroup}>
              {deleteConfirmState?.options.map((opt, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.confirmButton,
                    {
                      backgroundColor: opt.destructive ? COLORS.danger + '20' : COLORS.primary + '10',
                      borderColor: opt.destructive ? COLORS.danger : COLORS.primary,
                    },
                  ]}
                  onPress={opt.action}
                >
                  <Text style={[styles.confirmButtonText, { color: opt.destructive ? COLORS.danger : COLORS.primary }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  confirmBox: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  confirmTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  confirmMessage: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  confirmButtonGroup: { gap: 10 },
  confirmButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmButtonText: { fontSize: 14, fontWeight: '600' },
  container: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, maxHeight: '90%', borderTopWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600' },
  closeButton: { fontSize: 24, fontWeight: '300' },
  root: { flex: 1, backgroundColor: c.background },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  pageBody: { flex: 1 },
  form: { flex: 1, marginBottom: 12 },
  field: { marginBottom: 12 },
  stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, gap: 0 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  stepDotActive: { backgroundColor: c.primary, borderColor: c.primary },
  stepDotText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  stepDotTextActive: { color: '#fff' },
  stepLine: { width: 40, height: 2, backgroundColor: c.border, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: c.primary },
  stepTitle: { fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: 'top' },
  toggleGroup: { flexDirection: 'row', gap: 6 },
  toggleButton: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  toggleText: { fontSize: 12, fontWeight: '500' },
  calculatedAmount: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  dateInputContainer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dateTextInput: { flex: 1 },
  calendarButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  pickerText: { fontSize: 14 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 12 },
  pickerHeaderText: { fontSize: 14, fontWeight: '500', width: 50 },
  pickerHeaderTitle: { fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  accountOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  accountContent: { flex: 1 },
  accountName: { fontSize: 14, marginBottom: 4 },
  accountType: { fontSize: 12 },
  checkmark: { fontSize: 18, fontWeight: '600', marginLeft: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { borderWidth: 1 },
  buttonText: { fontSize: 14, fontWeight: '600' },
  submitButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  calendarContainer: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, maxHeight: '90%', borderTopWidth: 1 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 16 },
  calendarHeaderText: { fontSize: 14, fontWeight: '500', width: 50 },
  calendarTitle: { fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  calendarWrapper: { height: 420, justifyContent: 'flex-start' },
  calendar: { overflow: 'hidden' },
  // Info box
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 12 },
  infoIcon: { fontSize: 14, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 17 },
  // Note compte source = destination
  accountNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 8 },
  accountNoteIcon: { fontSize: 13, marginTop: 1 },
  accountNoteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  accountHint: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  errorBanner: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  errorBannerText: { fontSize: 13, color: c.danger, lineHeight: 18 },
  // Ponctuel
  ponctuelContainer: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  ponctuelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  ponctuelToggle: { padding: 2 },
  ponctuelDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.cardBorder, justifyContent: 'center', alignItems: 'center' },
  ponctuelDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  ponctuelLabel: { flex: 1, fontSize: 13 },
  ponctuelInput: { width: 90, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, textAlign: 'right' },
  ponctuelDash: { width: 90, textAlign: 'right', fontSize: 13, color: c.cardBorder },
  ponctuelTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  ponctuelTotalLabel: { fontSize: 13, fontWeight: '600' },
  ponctuelTotalAmount: { fontSize: 14, fontWeight: '700' },
});
}
