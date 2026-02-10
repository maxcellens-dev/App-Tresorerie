/**
 * Types alignés sur le schéma Supabase (profiles, accounts, categories, transactions).
 */

export type AccountType = 'checking' | 'savings' | 'investment' | 'other';
export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';
export type ObjectiveStatus = 'active' | 'completed' | 'paused';

export interface Profile {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  safety_threshold?: number;
  safety_threshold_min: number;
  safety_threshold_optimal: number;
  safety_threshold_comfort: number;
  safety_margin_percent?: number;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  profile_id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  profile_id: string;
  name: string;
  type: 'income' | 'expense';
  parent_id?: string | null;
  icon?: string | null;
  color?: string | null;
  is_variable?: boolean;
  is_default?: boolean;
  created_at: string;
}

export type RecurrenceRule = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Transaction {
  id: string;
  profile_id: string;
  account_id: string;
  category_id: string | null;
  project_id?: string | null;
  amount: number;
  date: string;
  note: string | null;
  is_forecast: boolean;
  is_reconciled: boolean;
  is_recurring?: boolean;
  recurrence_rule?: RecurrenceRule | null;
  recurrence_end_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionMonthOverride {
  id: string;
  profile_id: string;
  transaction_id: string;
  year: number;
  month: number;
  override_amount: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionWithDetails extends Transaction {
  account?: { name: string };
  category?: { name: string; type: string };
}

export interface Project {
  id: string;
  profile_id: string;
  name: string;
  description?: string | null;
  target_amount: number;
  monthly_allocation?: number | null;
  target_date?: string | null;
  source_account_id?: string | null;
  linked_account_id?: string | null;
  transaction_day?: number | null;
  current_accumulated?: number;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Objective {
  id: string;
  profile_id: string;
  name: string;
  description?: string | null;
  target_yearly_amount: number;
  category?: 'Objectif annuel' | 'Investissement' | 'Autre' | null;
  current_year_invested?: number | null;
  linked_account_id?: string | null;
  status: ObjectiveStatus;
  created_at: string;
  updated_at: string;
}

export interface ObjectiveWithAccount extends Objective {
  linked_account?: { name: string };
}
