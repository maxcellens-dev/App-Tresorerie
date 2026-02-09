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
  linked_account_id: string | null;
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
    linked_account_id: null,
    current_accumulated: 0,
  });

  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

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
        linked_account_id: editingProject.linked_account_id || null,
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
        linked_account_id: null,
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

    if (editingProject) {
      // Update existing project
      updateProjectMutation.mutate(
        {
          id: editingProject.id,
          name: form.name,
          description: form.description || undefined,
          target_amount: parseFloat(form.target_amount),
          monthly_allocation: monthlyAlloc,
          target_date: form.allocation_type === 'date' ? form.target_date : null,
          current_accumulated: form.current_accumulated,
          linked_account_id: form.linked_account_id || undefined,
        },
        {
          onSuccess: () => {
            setForm({
              name: '',
              description: '',
              target_amount: '',
              allocation_type: 'monthly',
              monthly_allocation: '',
              target_date: '',
              linked_account_id: null,
              current_accumulated: 0,
            });
            onSuccess?.();
            onClose();
          },
        }
      );
    } else {
      // Create new project
      addProjectMutation.mutate(
        {
          name: form.name,
          description: form.description || undefined,
          target_amount: parseFloat(form.target_amount),
          monthly_allocation: monthlyAlloc,
          target_date: form.allocation_type === 'date' ? form.target_date : undefined,
          current_accumulated: form.current_accumulated,
          linked_account_id: form.linked_account_id || undefined,
        },
        {
          onSuccess: () => {
            setForm({
              name: '',
              description: '',
              target_amount: '',
              allocation_type: 'monthly',
              monthly_allocation: '',
              target_date: '',
              linked_account_id: null,
              current_accumulated: 0,
            });
            onSuccess?.();
            onClose();
          },
        }
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
      linked_account_id: null,
      current_accumulated: 0,
    });
    setShowAccountPicker(false);
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
            <TouchableOpacity onPress={handleClose} disabled={(addProjectMutation.isPending || updateProjectMutation.isPending) || showAccountPicker}>
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
                    <TouchableOpacity
                      style={[
                        styles.input,
                        {
                          backgroundColor: COLORS.background,
                          borderColor: COLORS.border,
                          justifyContent: 'center',
                        },
                      ]}
                      onPress={() => setShowCalendar(true)}
                      disabled={addProjectMutation.isPending || showCalendar}
                    >
                      <Text
                        style={[
                          styles.pickerText,
                          {
                            color: form.target_date ? COLORS.text : COLORS.textSecondary,
                          },
                        ]}
                      >
                        {form.target_date ? formatDateFrench(form.target_date) : '27-01-2027'}
                      </Text>
                    </TouchableOpacity>
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

              {/* Linked Account */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Compte de destination (optionnel)
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
                  onPress={() => setShowAccountPicker(true)}
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
                      : 'Sélectionner un compte'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            /* Account Picker */
            <View style={styles.form}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowAccountPicker(false)}>
                  <Text style={[styles.pickerHeaderText, { color: COLORS.primary }]}>
                    Retour
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.pickerHeaderTitle, { color: COLORS.text }]}>
                  Sélectionner un compte
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
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.accountOption,
                        {
                          backgroundColor: COLORS.background,
                          borderBottomColor: COLORS.border,
                        },
                        item.id === form.linked_account_id && {
                          backgroundColor: COLORS.primary + '20',
                        },
                      ]}
                      onPress={() => {
                        setForm({ ...form, linked_account_id: item.id });
                        setShowAccountPicker(false);
                      }}
                    >
                      <View style={styles.accountContent}>
                        <Text
                          style={[
                            styles.accountName,
                            {
                              color: COLORS.text,
                              fontWeight: item.id === form.linked_account_id ? '600' : '400',
                            },
                          ]}
                        >
                          {item.name || 'Compte sans nom'}
                        </Text>
                        <Text style={[styles.accountType, { color: COLORS.textSecondary }]}>
                          {item.type}
                        </Text>
                      </View>
                      {item.id === form.linked_account_id && (
                        <Text style={[styles.checkmark, { color: COLORS.primary }]}>
                          ✓
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
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
      visible={showCalendar && visible}
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
              current={form.target_date || getTodayDateString()}
              minDate={getTodayDateString()}
              maxDate="2050-12-31"
              onDayPress={(day: any) => {
                setForm({ ...form, target_date: day.dateString });
                setShowCalendar(false);
              }}
              markedDates={getMarkedDates()}
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
