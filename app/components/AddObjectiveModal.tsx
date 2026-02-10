import React, { useState, useEffect } from 'react';
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
import { useAuth } from '../contexts/AuthContext';
import { useAddObjective, useUpdateObjective } from '../hooks/useObjectives';
import { useAccounts } from '../hooks/useAccounts';
import type { Objective } from '../types/database';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

interface AddObjectiveModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editingObjective?: Objective | null;
}

export default function AddObjectiveModal({
  visible,
  onClose,
  onSuccess,
  editingObjective,
}: AddObjectiveModalProps) {
  const { user } = useAuth();
  const addObjectiveMutation = useAddObjective(user?.id || '');
  const updateObjectiveMutation = useUpdateObjective(user?.id || '');
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(user?.id || '');

  const [form, setForm] = useState({
    name: '',
    description: '',
    target_yearly_amount: '',
    monthly_amount: '',
    linked_account_id: null as string | null,
  });

  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Load editing objective data when modal opens
  useEffect(() => {
    if (visible && editingObjective) {
      setForm({
        name: editingObjective.name || '',
        description: editingObjective.description || '',
        target_yearly_amount: editingObjective.target_yearly_amount?.toString() || '',
        monthly_amount: editingObjective.target_yearly_amount
          ? (editingObjective.target_yearly_amount / 12).toFixed(2).replace(/\.?0+$/, '')
          : '',
        linked_account_id: editingObjective.linked_account_id || null,
      });
    } else if (visible) {
      setForm({
        name: '',
        description: '',
        target_yearly_amount: '',
        monthly_amount: '',
        linked_account_id: null,
      });
    }
  }, [visible, editingObjective]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.target_yearly_amount.trim()) {
      alert('Veuillez remplir au moins le nom et le montant cible');
      return;
    }
    if (!form.linked_account_id) {
      alert('Veuillez sélectionner un compte lié');
      return;
    }

    if (editingObjective) {
      // Update existing objective
      updateObjectiveMutation.mutate(
        {
          id: editingObjective.id,
          name: form.name,
          description: form.description || undefined,
          target_yearly_amount: parseFloat(form.target_yearly_amount),
        },
        {
          onSuccess: () => {
            setForm({
              name: '',
              description: '',
              target_yearly_amount: '',
              monthly_amount: '',
              linked_account_id: null,
            });
            onSuccess?.();
            onClose();
          },
        }
      );
    } else {
      // Create new objective
      addObjectiveMutation.mutate(
        {
          name: form.name,
          description: form.description || undefined,
          target_yearly_amount: parseFloat(form.target_yearly_amount),
          linked_account_id: form.linked_account_id || undefined,
        },
        {
          onSuccess: () => {
            setForm({
              name: '',
              description: '',
              target_yearly_amount: '',
              monthly_amount: '',
              linked_account_id: null,
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
      target_yearly_amount: '',
      monthly_amount: '',
      linked_account_id: null,
    });
    setShowAccountPicker(false);
    onClose();
  };

  const selectedAccount = accounts.find((acc) => acc.id === form.linked_account_id);

  return (
    <Modal
      visible={visible}
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
              {editingObjective ? 'Modifier l\'Objectif' : 'Nouvel Objectif'}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              disabled={(addObjectiveMutation.isPending || updateObjectiveMutation.isPending) || showAccountPicker}
            >
              <Text style={[styles.closeButton, { color: COLORS.primary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          {!showAccountPicker ? (
            <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
              {/* Name */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Nom de l'objectif *
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
                  placeholder="Ex. Investir en bourse"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.name}
                  onChangeText={(text) => setForm({ ...form, name: text })}
                  editable={!(addObjectiveMutation.isPending || updateObjectiveMutation.isPending)}
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
                  placeholder="Détails de l'objectif"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.description}
                  onChangeText={(text) => setForm({ ...form, description: text })}
                  multiline
                  numberOfLines={3}
                  editable={!(addObjectiveMutation.isPending || updateObjectiveMutation.isPending)}
                />
              </View>

              {/* Target Yearly Amount */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Montant cible annuel (€) *
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
                  placeholder="5000"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.target_yearly_amount}
                  onChangeText={(text) => {
                    const clean = text.replace(/[^0-9.]/g, '');
                    const yearly = parseFloat(clean);
                    setForm({
                      ...form,
                      target_yearly_amount: clean,
                      monthly_amount: !isNaN(yearly) && yearly > 0
                        ? (yearly / 12).toFixed(2).replace(/\.?0+$/, '')
                        : '',
                    });
                  }}
                  keyboardType="decimal-pad"
                  editable={!(addObjectiveMutation.isPending || updateObjectiveMutation.isPending)}
                />
              </View>

              {/* Monthly Amount (linked) */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Mensuel (€)
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
                  placeholder="416.67"
                  placeholderTextColor={COLORS.textSecondary}
                  value={form.monthly_amount}
                  onChangeText={(text) => {
                    const clean = text.replace(/[^0-9.]/g, '');
                    const monthly = parseFloat(clean);
                    setForm({
                      ...form,
                      monthly_amount: clean,
                      target_yearly_amount: !isNaN(monthly) && monthly > 0
                        ? (monthly * 12).toFixed(2).replace(/\.?0+$/, '')
                        : '',
                    });
                  }}
                  keyboardType="decimal-pad"
                  editable={!(addObjectiveMutation.isPending || updateObjectiveMutation.isPending)}
                />
              </View>

              {/* Linked Account */}
              <View style={styles.field}>
                <Text style={[styles.label, { color: COLORS.text }]}>
                  Compte lié *
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
                  disabled={addObjectiveMutation.isPending}
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
                disabled={addObjectiveMutation.isPending}
              >
                <Text style={[styles.buttonText, { color: COLORS.text }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: COLORS.primary }]}
                onPress={handleSubmit}
                disabled={addObjectiveMutation.isPending || updateObjectiveMutation.isPending}
              >
                {addObjectiveMutation.isPending || updateObjectiveMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>
                    {editingObjective ? 'Mettre à jour' : 'Créer'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
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
    maxHeight: '95%',
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
    marginTop: 20,
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
});
