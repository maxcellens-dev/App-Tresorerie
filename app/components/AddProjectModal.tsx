import React, { useState, useMemo, useEffect } from 'react';
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
} from 'react-native';
import CalendarWithPicker from './CalendarWithPicker';
import { useAuth } from '../contexts/AuthContext';
import { useAddProject, useUpdateProject } from '../hooks/useProjects';
import { useAccounts } from '../hooks/useAccounts';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
  blue: '#60a5fa',
};

interface AddProjectModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editingProject?: Project | null;
}

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

export default function AddProjectModal({
  visible,
  onClose,
  onSuccess,
  editingProject,
}: AddProjectModalProps) {
  const { user } = useAuth();
  const addProjectMutation = useAddProject(user?.id || '');
  const updateProjectMutation = useUpdateProject(user?.id || '');
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(user?.id || '');

  const months12 = useMemo(() => getNext12Months(), []);

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

  const [showAccountPicker, setShowAccountPicker] = useState<'source' | 'destination' | null>(null);
  const [showCalendar, setShowCalendar] = useState<'target' | 'payment' | false>(false);

  // Load editing project data when modal opens
  useEffect(() => {
    if (visible && editingProject) {
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
          });
      } else {
        setPonctuelEntries({});
      }
    } else if (visible) {
      setForm({
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
      setPonctuelEntries({});
    }
  }, [visible, editingProject]);

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
    return months12.reduce((sum, m) => {
      const e = ponctuelEntries[m.key];
      if (e?.enabled && e.amount) return sum + (parseFloat(e.amount) || 0);
      return sum;
    }, 0);
  }, [ponctuelEntries, months12]);

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

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.target_amount.trim()) {
      alert('Veuillez remplir au moins le nom et le montant cible');
      return;
    }
    if (!form.source_account_id || !form.linked_account_id) {
      alert('Veuillez sélectionner un compte source et un compte de destination');
      return;
    }

    let monthlyAlloc = 0;
    let ponctuelList: { date: string; amount: number }[] | undefined;

    if (form.allocation_type === 'monthly') {
      if (!form.monthly_allocation.trim()) { alert('Veuillez entrer une allocation mensuelle'); return; }
      monthlyAlloc = parseFloat(form.monthly_allocation);
    } else if (form.allocation_type === 'date') {
      if (!form.target_date || !calculatedAllocation) { alert('Veuillez entrer une date cible valide'); return; }
      monthlyAlloc = calculatedAllocation;
    } else {
      // ponctuel
      ponctuelList = months12
        .filter((m) => ponctuelEntries[m.key]?.enabled && parseFloat(ponctuelEntries[m.key]?.amount || '0') > 0)
        .map((m) => ({ date: m.dayOne, amount: parseFloat(ponctuelEntries[m.key].amount) }));
      if (ponctuelList.length === 0) { alert('Veuillez activer au moins un mois avec un montant'); return; }
      monthlyAlloc = ponctuelTotal / ponctuelList.length;
    }

    const resetForm = () => {
      setForm({ name: '', description: '', target_amount: '', allocation_type: 'monthly', monthly_allocation: '', target_date: '', source_account_id: null, linked_account_id: null, first_payment_date: '', current_accumulated: 0 });
      setPonctuelEntries({});
      onSuccess?.();
      onClose();
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
    onClose();
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
    <>
      <Modal visible={visible && !showCalendar} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.container, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.title, { color: COLORS.text }]}>
                {editingProject ? 'Modifier Projet' : 'Nouveau Projet'}
              </Text>
              <TouchableOpacity onPress={handleClose} disabled={isPending || !!showAccountPicker}>
                <Text style={[styles.closeButton, { color: COLORS.primary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {!showAccountPicker ? (
              <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
                {/* Nom */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>Nom du projet *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                    placeholder="Ex. Nouvelle voiture"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.name}
                    onChangeText={(t) => setForm({ ...form, name: t })}
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
                  <Text style={[styles.label, { color: COLORS.text }]}>Montant cible (€) *</Text>
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
                    <Text style={[styles.label, { color: COLORS.text }]}>Allocation mensuelle (€) *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: COLORS.background, color: COLORS.text, borderColor: COLORS.border }]}
                      placeholder="500"
                      placeholderTextColor={COLORS.textSecondary}
                      value={form.monthly_allocation}
                      onChangeText={(t) => setForm({ ...form, monthly_allocation: t.replace(/[^0-9.]/g, '') })}
                      keyboardType="decimal-pad"
                      editable={!isPending}
                    />
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
                          {calculatedAllocation.toFixed(2)} €/mois
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Ponctuel */}
                {form.allocation_type === 'ponctuel' && (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>Apports par mois</Text>
                    <View style={[styles.ponctuelContainer, { backgroundColor: COLORS.background, borderColor: COLORS.border }]}>
                      {months12.map((m, idx) => {
                        const entry = ponctuelEntries[m.key];
                        const enabled = entry?.enabled ?? false;
                        return (
                          <View
                            key={m.key}
                            style={[
                              styles.ponctuelRow,
                              idx < months12.length - 1 && { borderBottomWidth: 1, borderBottomColor: COLORS.border },
                            ]}
                          >
                            <TouchableOpacity
                              style={styles.ponctuelToggle}
                              onPress={() => togglePonctuelMonth(m.key)}
                              activeOpacity={0.7}
                            >
                              <View style={[styles.ponctuelDot, enabled && { backgroundColor: COLORS.blue, borderColor: COLORS.blue }]}>
                                {enabled && <View style={styles.ponctuelDotInner} />}
                              </View>
                            </TouchableOpacity>
                            <Text style={[styles.ponctuelLabel, { color: enabled ? COLORS.text : COLORS.textSecondary }]}>
                              {m.label}
                            </Text>
                            {enabled ? (
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
                          {ponctuelTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                        </Text>
                      </View>
                    </View>
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
                </View>

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

            {/* Actions */}
            {!showAccountPicker && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton, { borderColor: COLORS.border }]}
                  onPress={handleClose}
                  disabled={isPending}
                >
                  <Text style={[styles.buttonText, { color: COLORS.text }]}>Annuler</Text>
                </TouchableOpacity>
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
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Calendar modal */}
      <Modal visible={!!showCalendar && visible} transparent animationType="slide" onRequestClose={() => setShowCalendar(false)}>
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.calendarContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
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
                bgColor={COLORS.surface}
                textColor={COLORS.text}
                textSecondaryColor={COLORS.textSecondary}
                style={styles.calendar}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  container: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, maxHeight: '90%', borderTopWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600' },
  closeButton: { fontSize: 24, fontWeight: '300' },
  form: { marginBottom: 16 },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: 'top' },
  toggleGroup: { flexDirection: 'row', gap: 6 },
  toggleButton: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', alignItems: 'center' },
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
  // Ponctuel
  ponctuelContainer: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  ponctuelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  ponctuelToggle: { padding: 2 },
  ponctuelDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  ponctuelDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  ponctuelLabel: { flex: 1, fontSize: 13 },
  ponctuelInput: { width: 90, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, textAlign: 'right' },
  ponctuelDash: { width: 90, textAlign: 'right', fontSize: 13, color: '#334155' },
  ponctuelTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  ponctuelTotalLabel: { fontSize: 13, fontWeight: '600' },
  ponctuelTotalAmount: { fontSize: 14, fontWeight: '700' },
});
