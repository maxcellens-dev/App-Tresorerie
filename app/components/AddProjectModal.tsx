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
import { Calendar } from 'react-native-calendars';
import { useAuth } from '../contexts/AuthContext';
import { useAddProject, useUpdateProject } from '../hooks/useProjects';
import { useAccounts } from '../hooks/useAccounts';
import type { Project } from '../types/database';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

interface AddProjectModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editingProject?: Project | null;
}

interface FormState {
  name: string;
  description: string;
  target_amount: string;
  allocation_type: 'monthly' | 'date';
  monthly_allocation: string;
  target_date: string;
  source_account_id: string | null;
  linked_account_id: string | null;
  first_payment_date: string;
  current_accumulated: number;
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

  const [showAccountPicker, setShowAccountPicker] = useState<'source' | 'destination' | null>(null);
  const [showCalendar, setShowCalendar] = useState<'target' | 'payment' | false>(false);

  // Load editing project data when modal opens
  useEffect(() => {
    if (visible && editingProject) {
      setForm({
        name: editingProject.name || '',
        description: editingProject.description || '',
        target_amount: editingProject.target_amount?.toString() || '',
        allocation_type: editingProject.target_date ? 'date' : 'monthly',
        monthly_allocation: editingProject.monthly_allocation?.toString() || '',
        target_date: editingProject.target_date || '',
        source_account_id: editingProject.source_account_id || null,
        linked_account_id: editingProject.linked_account_id || null,
        first_payment_date: editingProject.transaction_day ? (() => { const d = new Date(); d.setDate(editingProject.transaction_day!); return d.toISOString().slice(0, 10); })() : '',
        current_accumulated: editingProject.current_accumulated || 0,
      });
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
    }
  }, [visible, editingProject]);

  // Calculate monthly allocation automatically if target_date is set
  const calculatedAllocation = useMemo(() => {
    if (form.allocation_type !== 'date' || !form.target_date || !form.target_amount) {
      return null;
    }

    const targetAmount = parseFloat(form.target_amount);
    const targetDate = new Date(form.target_date);
    const today = new Date();

    if (targetDate <= today) {
      return null;
    }

    const monthsRemaining = Math.max(1, Math.ceil(
      (targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));

    const amountToAccumulate = Math.max(0, targetAmount - form.current_accumulated);
    return amountToAccumulate / monthsRemaining;
  }, [form.allocation_type, form.target_date, form.target_amount, form.current_accumulated]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.target_amount.trim()) {
      alert('Veuillez remplir au moins le nom et le montant cible');
      return;
    }

    if (!form.source_account_id || !form.linked_account_id) {
      alert('Veuillez sélectionner un compte source et un compte de destination');
      return;
    }

    let monthlyAlloc: number;
    if (form.allocation_type === 'monthly') {
      if (!form.monthly_allocation.trim()) {
        alert('Veuillez entrer une allocation mensuelle');
        return;
      }
      monthlyAlloc = parseFloat(form.monthly_allocation);
    } else {
      if (!form.target_date || !calculatedAllocation) {
        alert('Veuillez entrer une date cible valide');
        return;
      }
      monthlyAlloc = calculatedAllocation;
    }

    const resetForm = () => {
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
          target_date: form.allocation_type === 'date' ? form.target_date : null,
          current_accumulated: form.current_accumulated,
          source_account_id: form.source_account_id,
          linked_account_id: form.linked_account_id,
          transaction_day: form.first_payment_date ? new Date(form.first_payment_date).getDate() : 1,
          first_payment_date: form.first_payment_date || undefined,
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
          target_date: form.allocation_type === 'date' ? form.target_date : undefined,
          current_accumulated: form.current_accumulated,
          source_account_id: form.source_account_id || undefined,
          linked_account_id: form.linked_account_id || undefined,
          transaction_day: form.first_payment_date ? new Date(form.first_payment_date).getDate() : 1,
          first_payment_date: form.first_payment_date || undefined,
        },
        { onSuccess: resetForm }
      );
    }
  };

  const handleClose = () => {
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
    setShowAccountPicker(null);
    setShowCalendar(false);
    onClose();
  };

  // Format date from YYYY-MM-DD to jj-mm-aaaa
  const formatDateFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-');
      return `${day}-${month}-${year}`;
    } catch {
      return dateStr;
    }
  };

  // Parse date from jj-mm-aaaa or jjmmaaaa to YYYY-MM-DD
  const parseDateFromFrench = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      // Remove any non-digit characters for flexibility
      const cleaned = dateStr.replace(/\D/g, '');
      
      if (cleaned.length === 8) {
        const day = cleaned.substring(0, 2);
        const month = cleaned.substring(2, 4);
        const year = cleaned.substring(4, 8);
        
        // Validate date
        const date = new Date(`${year}-${month}-${day}`);
        if (isNaN(date.getTime())) return '';
        
        // Check if date is today or in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (date < today) return '';
        
        return `${year}-${month}-${day}`;
      }
    } catch {
      return '';
    }
    return '';
  };

  // Get marked dates for calendar (highlight selected date)
  const getMarkedDates = () => {
    if (!form.target_date) return {};
    return {
      [form.target_date]: {
        selected: true,
        selectedColor: COLORS.primary,
        selectedTextColor: '#fff',
      },
    };
  };

  // Get today's date for minimum selectable date
  const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const selectedSourceAccount = accounts.find((acc) => acc.id === form.source_account_id);
  const selectedAccount = accounts.find((acc) => acc.id === form.linked_account_id);

  return (
    <>
      <Modal
        visible={visible && !showCalendar}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
      <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}>
        <View
          style={[
            styles.container,
            { backgroundColor: COLORS.surface, borderColor: COLORS.border },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: COLORS.text }]}>
              {editingProject ? 'Modifier Projet' : 'Nouveau Projet'}
            </Text>
            <TouchableOpacity onPress={handleClose} disabled={(addProjectMutation.isPending || updateProjectMutation.isPending) || !!showAccountPicker}>
              <Text style={[styles.closeButton, { color: COLORS.primary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Form or Account Picker */}
          {!showAccountPicker ? (
            <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
              {/* Name */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Nom du projet *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: COLORS.background,
                      color: COLORS.text,
                      borderColor: COLORS.border,
                    },
                  ]}
                  placeholder="Ex. Nouvelle voiture"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.name}
                  onChangeText={(text) => setForm({ ...form, name: text })}
                  editable={!addProjectMutation.isPending}
                />
              </View>

              {/* Description */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Description (optionnel)
                </Text>
                <TextInput
                  style={[
                    styles.textarea,
                    {
                      backgroundColor: COLORS.background,
                      color: COLORS.text,
                      borderColor: COLORS.border,
                    },
                  ]}
                  placeholder="Détails du projet"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.description}
                  onChangeText={(text) => setForm({ ...form, description: text })}
                  multiline
                  numberOfLines={2}
                  editable={!(addProjectMutation.isPending || updateProjectMutation.isPending)}
                />
              </View>

              {/* Target Amount */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Montant cible (€) *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: COLORS.background,
                      color: COLORS.text,
                      borderColor: COLORS.border,
                    },
                  ]}
                  placeholder="10000"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.target_amount}
                  onChangeText={(text) =>
                    setForm({ ...form, target_amount: text.replace(/[^0-9.]/g, '') })
                  }
                  keyboardType="decimal-pad"
                  editable={!(addProjectMutation.isPending || updateProjectMutation.isPending)}
                />
              </View>

              {/* Allocation Type Toggle */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Planification
                </Text>
                <View style={styles.toggleGroup}>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      form.allocation_type === 'monthly' && 
                      { backgroundColor: COLORS.primary + '30', borderColor: COLORS.primary }
                    ]}
                    onPress={() => setForm({ ...form, allocation_type: 'monthly' })}
                  >
                    <Text style={[styles.toggleText, { color: COLORS.text }]}>
                      Allocation mensuelle
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      form.allocation_type === 'date' && 
                      { backgroundColor: COLORS.primary + '30', borderColor: COLORS.primary }
                    ]}
                    onPress={() => setForm({ ...form, allocation_type: 'date' })}
                  >
                    <Text style={[styles.toggleText, { color: COLORS.text }]}>
                      Date cible
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Conditional: Monthly Allocation */}
              {form.allocation_type === 'monthly' && (
                <View style={styles.field}>
                  <Text style={[styles.label, { color: COLORS.text }]}>
                    Allocation mensuelle (€) *
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: COLORS.background,
                        color: COLORS.text,
                        borderColor: COLORS.border,
                      },
                    ]}
                    placeholder="500"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.monthly_allocation}
                    onChangeText={(text) =>
                      setForm({ ...form, monthly_allocation: text.replace(/[^0-9.]/g, '') })
                    }
                    keyboardType="decimal-pad"
                    editable={!addProjectMutation.isPending}
                  />
                </View>
              )}

              {/* Conditional: Target Date */}
              {form.allocation_type === 'date' && (
                <>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: COLORS.text }]}>
                      Date cible (jj-mm-aaaa) *
                    </Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.dateTextInput,
                          {
                            backgroundColor: COLORS.background,
                            borderColor: COLORS.border,
                            color: COLORS.text,
                          },
                        ]}
                        placeholder="jj-mm-aaaa"
                        placeholderTextColor={COLORS.textSecondary}
                        value={form.target_date ? formatDateFrench(form.target_date) : ''}
                        onChangeText={(text) => {
                          const parsed = parseDateFromFrench(text);
                          if (parsed) {
                            setForm({ ...form, target_date: parsed });
                          } else if (text === '') {
                            setForm({ ...form, target_date: '' });
                          }
                        }}
                        editable={!(addProjectMutation.isPending || updateProjectMutation.isPending)}
                      />
                      <TouchableOpacity
                        style={[
                          styles.calendarButton,
                          {
                            backgroundColor: COLORS.primary + '20',
                            borderColor: COLORS.primary,
                          },
                        ]}
                        onPress={() => setShowCalendar('target')}
                        disabled={addProjectMutation.isPending || updateProjectMutation.isPending}
                      >
                        <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {calculatedAllocation !== null && (
                    <View style={[styles.field, { backgroundColor: COLORS.background, padding: 12, borderRadius: 8 }]}>
                      <Text style={[styles.label, { color: COLORS.primary }]}>
                        Allocation calculée
                      </Text>
                      <Text style={[styles.calculatedAmount, { color: COLORS.primary }]}>
                        {calculatedAllocation.toFixed(2)} €/mois
                      </Text>
                    </View>
                  )}
                </>
              )}

              {/* Compte source */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Compte source *
                </Text>
                <TouchableOpacity
                  style={[
                    styles.input,
                    {
                      backgroundColor: COLORS.background,
                      borderColor: COLORS.border,
                      justifyContent: 'center',
                    },
                  ]}
                  onPress={() => setShowAccountPicker('source')}
                  disabled={addProjectMutation.isPending}
                >
                  <Text
                    style={[
                      styles.pickerText,
                      {
                        color: selectedSourceAccount ? COLORS.text : COLORS.textSecondary,
                      },
                    ]}
                  >
                    {selectedSourceAccount
                      ? `${selectedSourceAccount.name || 'Compte sans nom'}`
                      : 'Sélectionner le compte source'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Compte de destination */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Compte de destination *
                </Text>
                <TouchableOpacity
                  style={[
                    styles.input,
                    {
                      backgroundColor: COLORS.background,
                      borderColor: COLORS.border,
                      justifyContent: 'center',
                    },
                  ]}
                  onPress={() => setShowAccountPicker('destination')}
                  disabled={addProjectMutation.isPending}
                >
                  <Text
                    style={[
                      styles.pickerText,
                      {
                        color: selectedAccount ? COLORS.text : COLORS.textSecondary,
                      },
                    ]}
                  >
                    {selectedAccount
                      ? `${selectedAccount.name || 'Compte sans nom'}`
                      : 'Sélectionner le compte destination'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Date du premier virement */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Date du premier virement
                </Text>
                <View style={styles.dateInputContainer}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.dateTextInput,
                      {
                        backgroundColor: COLORS.background,
                        borderColor: COLORS.border,
                        color: COLORS.text,
                      },
                    ]}
                    placeholder="jj-mm-aaaa"
                    placeholderTextColor={COLORS.textSecondary}
                    value={form.first_payment_date ? formatDateFrench(form.first_payment_date) : ''}
                    onChangeText={(text) => {
                      const parsed = parseDateFromFrench(text);
                      if (parsed) {
                        setForm({ ...form, first_payment_date: parsed });
                      } else if (text === '') {
                        setForm({ ...form, first_payment_date: '' });
                      }
                    }}
                    editable={!(addProjectMutation.isPending || updateProjectMutation.isPending)}
                  />
                  <TouchableOpacity
                    style={[
                      styles.calendarButton,
                      {
                        backgroundColor: COLORS.primary + '20',
                        borderColor: COLORS.primary,
                      },
                    ]}
                    onPress={() => setShowCalendar('payment')}
                    disabled={addProjectMutation.isPending || updateProjectMutation.isPending}
                  >
                    <Text style={{ fontSize: 20, color: COLORS.primary }}>📅</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          ) : (
            /* Account Picker */
            <View style={styles.form}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowAccountPicker(null)}>
                  <Text style={[styles.pickerHeaderText, { color: COLORS.primary }]}>
                    Retour
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.pickerHeaderTitle, { color: COLORS.text }]}>
                  {showAccountPicker === 'source' ? 'Compte source' : 'Compte destination'}
                </Text>
                <View style={{ width: 50 }} />
              </View>
              {accountsLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color={COLORS.primary} />
                </View>
              ) : (
                <FlatList
                  data={accounts}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const currentId = showAccountPicker === 'source' ? form.source_account_id : form.linked_account_id;
                    const isSelected = item.id === currentId;
                    return (
                    <TouchableOpacity
                      style={[
                        styles.accountOption,
                        {
                          backgroundColor: COLORS.background,
                          borderBottomColor: COLORS.border,
                        },
                        isSelected && {
                          backgroundColor: COLORS.primary + '20',
                        },
                      ]}
                      onPress={() => {
                        if (showAccountPicker === 'source') {
                          setForm({ ...form, source_account_id: item.id });
                        } else {
                          setForm({ ...form, linked_account_id: item.id });
                        }
                        setShowAccountPicker(null);
                      }}
                    >
                      <View style={styles.accountContent}>
                        <Text
                          style={[
                            styles.accountName,
                            {
                              color: COLORS.text,
                              fontWeight: isSelected ? '600' : '400',
                            },
                          ]}
                        >
                          {item.name || 'Compte sans nom'}
                        </Text>
                        <Text style={[styles.accountType, { color: COLORS.textSecondary }]}>
                          {item.type}
                        </Text>
                      </View>
                      {isSelected && (
                        <Text style={[styles.checkmark, { color: COLORS.primary }]}>
                          ✓
                        </Text>
                      )}
                    </TouchableOpacity>
                    );
                  }}
                  scrollEnabled={true}
                />
              )}
            </View>
          )}

          {/* Actions */}
          {!showAccountPicker && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.cancelButton,
                  { borderColor: COLORS.border },
                ]}
                onPress={handleClose}
                disabled={addProjectMutation.isPending}
              >
                <Text style={[styles.buttonText, { color: COLORS.text }]}>
                  Annuler
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: COLORS.primary }]}
                onPress={handleSubmit}
                disabled={addProjectMutation.isPending || updateProjectMutation.isPending}
              >
                {addProjectMutation.isPending || updateProjectMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>
                    {editingProject ? 'Mettre à jour' : 'Créer'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>

    <Modal
      visible={!!showCalendar && visible}
      transparent
      animationType="slide"
      onRequestClose={() => setShowCalendar(false)}
    >
      <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}>
        <View
          style={[
            styles.calendarContainer,
            { backgroundColor: COLORS.surface, borderColor: COLORS.border },
          ]}
        >
          {/* Calendar Header */}
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={() => setShowCalendar(false)}>
              <Text style={[styles.calendarHeaderText, { color: COLORS.primary }]}>
                Fermer
              </Text>
            </TouchableOpacity>
            <Text style={[styles.calendarTitle, { color: COLORS.text }]}>
              Sélectionner une date
            </Text>
            <View style={{ width: 50 }} />
          </View>

          {/* Calendar */}
          <View style={styles.calendarWrapper}>
            <Calendar
              current={showCalendar === 'payment' ? (form.first_payment_date || getTodayDateString()) : (form.target_date || getTodayDateString())}
              maxDate="2050-12-31"
              onDayPress={(day: any) => {
                if (showCalendar === 'payment') {
                  setForm({ ...form, first_payment_date: day.dateString });
                } else {
                  setForm({ ...form, target_date: day.dateString });
                }
                setShowCalendar(false);
              }}
              markedDates={(() => {
                const dateStr = showCalendar === 'payment' ? form.first_payment_date : form.target_date;
                if (!dateStr) return {};
                return { [dateStr]: { selected: true, selectedColor: COLORS.primary, selectedTextColor: '#fff' } };
              })()}
              theme={{
                backgroundColor: COLORS.surface,
                calendarBackground: COLORS.surface,
                textSectionTitleColor: COLORS.text,
                textSectionTitleDisabledColor: COLORS.textSecondary,
                selectedDayBackgroundColor: COLORS.primary,
                selectedDayTextColor: '#fff',
                todayTextColor: COLORS.primary,
                todayBackgroundColor: 'transparent',
                todayDotColor: COLORS.primary,
                dayTextColor: COLORS.text,
                textDisabledColor: COLORS.textSecondary,
                dotColor: COLORS.primary,
                selectedDotColor: '#fff',
                arrowColor: COLORS.primary,
                disabledArrowColor: COLORS.textSecondary,
                monthTextColor: COLORS.text,
                indicatorColor: COLORS.primary,
                textMonthFontWeight: '600',
                textDayFontSize: 14,
                textMonthFontSize: 16,
                textDayHeaderFontSize: 12,
              }}
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
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    maxHeight: '80%',
    borderTopWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    fontSize: 24,
    fontWeight: '300',
  },
  form: {
    marginBottom: 16,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  calculatedAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  dateInputContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dateTextInput: {
    flex: 1,
  },
  calendarButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerText: {
    fontSize: 14,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
  pickerHeaderText: {
    fontSize: 14,
    fontWeight: '500',
    width: 50,
  },
  pickerHeaderTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  accountContent: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    marginBottom: 4,
  },
  accountType: {
    fontSize: 12,
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  calendarContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    maxHeight: '90%',
    borderTopWidth: 1,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
  },
  calendarHeaderText: {
    fontSize: 14,
    fontWeight: '500',
    width: 50,
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  calendarWrapper: {
    height: 420,
    justifyContent: 'flex-start',
  },
  calendar: {
    overflow: 'hidden',
  },
});
