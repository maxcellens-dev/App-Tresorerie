import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Modal,
  View,
  TouchableWithoutFeedback,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TransactionWithDetails } from '../types/database';

interface TransactionAmountCellProps {
  amount: number;
  monthKey: string;
  categoryId: string | null;
  rowType: 'income' | 'expense' | 'balance';
  isParentCategory?: boolean;
  onViewDetail: (monthKey: string, categoryId: string | null) => void;
  onEditMonth?: (monthKey: string) => void;
  transaction?: TransactionWithDetails;
  isRecurring?: boolean;
  styleOverrides?: any;
}

export default function TransactionAmountCell({
  amount,
  monthKey,
  categoryId,
  rowType,
  isParentCategory,
  onViewDetail,
  onEditMonth,
  transaction,
  isRecurring,
  styleOverrides,
}: TransactionAmountCellProps) {
  const [menuVisible, setMenuVisible] = useState(false);

  const isPos = amount >= 0;
  const isBalance = rowType === 'balance';

  const handleLongPress = () => {
    if (isRecurring && onEditMonth) {
      setMenuVisible(true);
    }
  };

  const handleViewDetail = () => {
    setMenuVisible(false);
    onViewDetail(monthKey, categoryId);
  };

  const handleEditMonth = () => {
    setMenuVisible(false);
    if (onEditMonth) {
      onEditMonth(monthKey);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styleOverrides || {}]}
        onPress={handleViewDetail}
        onLongPress={handleLongPress}
        delayLongPress={200}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.text,
            rowType === 'income' && styles.positive,
            rowType === 'expense' && styles.negative,
            isBalance && (isPos ? styles.positive : styles.negative),
            isParentCategory && styles.parentCategory,
          ]}
          numberOfLines={1}
        >
          {amount !== 0 ? amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '–'}
        </Text>
      </TouchableOpacity>

      {/* Context Menu Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="none"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
          <View style={styles.menuOverlay}>
            <View style={styles.menu}>
              {isRecurring && (
                <Pressable style={styles.menuItem} onPress={handleEditMonth}>
                  <Ionicons name="pencil" size={16} color="#34d399" />
                  <Text style={styles.menuItemText}>Modifier prix ce mois</Text>
                </Pressable>
              )}
              <Pressable style={styles.menuItem} onPress={handleViewDetail}>
                <Ionicons name="eye" size={16} color="#60a5fa" />
                <Text style={styles.menuItemText}>Voir transaction</Text>
              </Pressable>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 13,
    color: '#ffffff',
  },
  positive: {
    color: '#34d399',
    fontWeight: '600',
  },
  negative: {
    color: '#f87171',
    fontWeight: '600',
  },
  parentCategory: {
    fontWeight: '700',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
    minWidth: 220,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 41, 59, 0.5)',
  },
  menuItemText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
});
