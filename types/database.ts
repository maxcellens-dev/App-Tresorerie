/**
 * Types alignés sur le schéma Supabase (profiles, accounts, categories, transactions).
 */

export type AccountType = 'checking' | 'savings' | 'investment' | 'other';
export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';
export type ObjectiveStatus = 'active' | 'completed' | 'paused';

export type FinancialProfile = 'economiser' | 'suivi' | 'optimiser' | 'investir';

// ── Nouveau système de profils financiers P1-P5 ───────────────

export type FinancialProfileId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export type ProfileSource = 'questionnaire' | 'automatic';
export type ChangeReason =
  | 'questionnaire_update'
  | 'automatic_upgrade'
  | 'automatic_downgrade'
  | 'exceptional_revenue_drop'
  | 'monthly_recap';

export interface UserFinancialProfile {
  user_id: string;
  profile_id: FinancialProfileId;
  profile_source: ProfileSource;
  assigned_at: string;
  auto_unlock_at: string | null;
  is_irregular_income: boolean;
  consecutive_upgrade_months: number;
  consecutive_downgrade_months: number;
  last_auto_evaluation: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserQuestionnaireAnswers {
  user_id: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  q7: string;
  /** Montant minimum conservé sur les comptes courants (€), sous forme de chaîne. Vide = 0. */
  q8: string;
  /** Estimation hebdomadaire des dépenses variables (€/semaine), sous forme de chaîne. Vide = non renseigné. */
  q9: string;
  answered_at: string;
  updated_at: string;
}

export interface ProfileChangeLog {
  id: string;
  user_id: string;
  previous_profile: string | null;
  new_profile: string;
  change_reason: ChangeReason;
  triggered_at: string;
  notification_shown: boolean;
}

export interface ProfileMatrixConfig {
  transition: string;
  upgrade_months_threshold: number;
  upgrade_flux_threshold: number;
  downgrade_months_threshold: number;
  downgrade_flux_threshold: number;
  anti_yoyo_months: number;
  exceptional_drop_threshold_pct: number;
  exceptional_drop_months: number;
  irregular_drop_threshold_pct: number;
  auto_eval_enabled: boolean;
  freeze_months: number;
  flux_window_months: number;
  expenses_window_months: number;
  updated_at: string;
  updated_by: string | null;
}

export interface ProfileNotificationMessage {
  transition: string;
  direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same';
  title: string;
  body: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Profile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  safety_threshold?: number;
  safety_threshold_min: number;
  safety_threshold_optimal: number;
  safety_threshold_comfort: number;
  /** @deprecated — remplacé par safety_margin_amount */
  safety_margin_percent?: number;
  /** Montant minimum conservé sur les comptes courants (€). Saisi en Q8. */
  safety_margin_amount?: number;
  /** Estimation hebdomadaire des dépenses variables (€/semaine). Saisi en Q9. Repli quand l'historique est insuffisant. */
  weekly_variable_budget?: number;
  financial_profile?: FinancialProfile;
  allocation_save_percent?: number;
  allocation_invest_percent?: number;
  allocation_enjoy_percent?: number;
  allocation_keep_percent?: number;
  initial_onboarding_completed?: boolean;
  financial_profile_questionnaire_completed?: boolean;
  is_admin?: boolean;
  theme_mode?: 'dark' | 'light';
  theme_preset?: 'emerald' | 'ocean' | 'violet' | 'coral' | 'amber';
  currency_code?: string;
  /** Notifications (push + annonces) activées — toggle dans Paramètres. */
  notifications_enabled?: boolean;
  /** Cosmétiques équipés par emplacement (cadre d'avatar, titre, flamme de série). */
  equipped_cosmetics?: Record<string, string>;
  /** Préférences d'interface + masquages de recommandations, stockés par compte (cf. useUiPrefs). */
  ui_prefs?: UiPrefs;
  created_at: string;
  updated_at: string;
}

/** Masquages de recommandations pour le mois courant (par compte). */
export interface RecoDismissals {
  month: string;                       // 'YYYY-MM'
  ignored: Record<string, number>;     // recoType → montant ignoré
  completed: string[];                 // recoTypes complétés
}

/** Préférences d'interface stockées par compte (profiles.ui_prefs). */
export interface UiPrefs {
  /** Affichage des conseils en haut du Pilotage (défaut : activé). */
  pilotage_tips_enabled?: boolean;
  /** Accès rapide à la calculatrice flottante (défaut : activé). */
  calculator_enabled?: boolean;
  /** Position du bouton « + » de saisie rapide dans la barre d'onglets (défaut : 'right'). */
  quick_add_position?: 'right' | 'left' | 'hidden';
  /** #2 — Filtre des totaux de la page Comptes : tout / perso / partagés. */
  accounts_totals_filter?: 'all' | 'perso' | 'shared';
  /** Recommandations ignorées / complétées du mois courant. */
  reco_dismissals?: RecoDismissals;
}

export interface Account {
  id: string;
  profile_id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  is_active: boolean;
  fiscal_envelope?: 'pea' | 'av' | 'cto' | 'autre' | null;
  /** Date ISO (YYYY-MM-DD) à laquelle le solde initial a été constaté. */
  init_date?: string | null;
  /** Investissement : total apporté à la création (capital injecté de départ). */
  initial_contributed?: number | null;
  /** Investissement : apport « actuel » (capital injecté net des retraits, modifiable). */
  current_contributed?: number | null;
  /** Compte joint dédié (partagé entre plusieurs utilisateurs). */
  is_joint?: boolean;
  /** #5 — % d'impact de l'OWNER sur ce compte dans SON app (0..100). NULL = part égale auto (100/N). */
  owner_impact_pct?: number | null;
  /**
   * Rôle de l'utilisateur courant sur ce compte (calculé côté client par useAccounts) :
   * 'owner' = mon compte ; 'write'/'read' = compte partagé reçu d'un autre utilisateur.
   */
  _role?: 'owner' | 'write' | 'read';
  /** #5 — % d'impact EFFECTIF de l'utilisateur courant sur ce compte (calculé : explicite ou 100/N). */
  _impact_pct?: number;
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
  sort_order?: number | null;
  created_at: string;
}

export type RecurrenceRule = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Transaction {
  id: string;
  profile_id: string;
  account_id: string;
  category_id: string | null;
  project_id?: string | null;
  linked_account_id?: string | null;
  amount: number;
  date: string;
  note: string | null;
  is_forecast: boolean;
  is_reconciled: boolean;
  is_draft?: boolean;
  /** Brouillon « Conservé » : montant mis de côté (Réservé) sans être validé. */
  is_reserved?: boolean;
  is_recurring?: boolean;
  recurrence_rule?: RecurrenceRule | null;
  recurrence_end_date?: string | null;
  /** Modèle récurrent d'origine si cette ligne est une occurrence matérialisée. */
  materialized_from?: string | null;
  /** Portée au solde du compte ? false pour une dépense future non récurrente en attente d'échéance. */
  posted?: boolean;
  /** §P12 — Transaction datée LE JOUR d'une régularisation et déclarée « déjà incluse » dans ce
   *  solde régularisé → elle ne compte pas dans le solde (le recalcul l'exclut). N'est utile QUE
   *  pour le cas « même jour » : l'absorption « avant la régul » est dérivée de la date au recalcul. */
  regul_covered?: boolean;
  /** Pour une ligne de régularisation : solde cible saisi par l'utilisateur (affichage). */
  regul_target?: number | null;
  /** #4bis — compte joint : opération saisie « au nom de » ce membre (non-user) pour simuler sa participation. */
  on_behalf_member_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionWithDetails extends Transaction {
  account?: { name: string; type: string; currency?: string } | null;
  category?: { name: string; type: string } | null;
  linked_account?: { name: string; type: string; currency?: string } | null;
  /** Mois d'affichage (YYYY-MM) pour les écritures récurrentes projetées. */
  displayDate?: string;
}

export type CreditType = 'immobilier' | 'consommation' | 'auto' | 'autre';

/** Module Crédit — paramètres d'un crédit (le tableau d'amortissement est calculé côté client). */
export interface Credit {
  id: string;
  profile_id: string;
  type: CreditType;
  label: string;
  lender?: string | null;
  account_id?: string | null;
  project_id?: string | null;
  principal: number;
  start_date: string;
  first_payment_date?: string | null;
  /** Date de 1ʳᵉ échéance de l'ASSURANCE (peut différer du remboursement). NULL → first_payment_date. */
  first_insurance_date?: string | null;
  duration_months: number;
  rate_annual: number;
  rate_type: 'fixe' | 'variable' | 'mixte';
  insurance_monthly?: number | null;
  fees_file?: number | null;
  fees_guarantee?: number | null;
  fees_bank?: number | null;
  fees_notary?: number | null;
  personal_contribution?: number | null;
  interim_interest?: number | null;
  management_fees?: number | null;
  other_fees?: number | null;
  /** Intérêts totaux saisis manuellement (bypass du calcul par le taux) pour la décomposition des coûts. */
  interest_total_manual?: number | null;
  /** #5 — assurance mensuelle par année (index 0 = an 1). */
  insurance_yearly?: (number | null)[] | null;
  /** #6 — mensualité forcée par année (index 0 = an 1). */
  payment_yearly?: (number | null)[] | null;
  /** Overrides manuels du tableau d'amortissement par échéance (toutes colonnes) :
   *  { "<n°>": { p?, i?, int?, cap?, rd?, d? } } (mensualité, assurance, intérêts, capital, restant dû, date). */
  schedule_overrides?: Record<string, { p?: number | null; i?: number | null; int?: number | null; cap?: number | null; rd?: number | null; d?: string | null }> | null;
  early_repayment_penalty_pct?: number | null;
  deferral_months?: number | null;
  deferral_type?: 'none' | 'partial' | 'total' | null;
  is_simulation: boolean;
  is_active: boolean;
  notes?: string | null;
  /** Rôle de l'utilisateur courant sur ce crédit : 'owner' (le mien) ou 'write'/'read' (crédit partagé reçu). */
  _role?: 'owner' | 'write' | 'read';
  created_at: string;
  updated_at: string;
}

export interface TransactionMonthOverride {
  id: string;
  profile_id: string;
  transaction_id: string;
  year: number;
  month: number;
  override_amount: number | null;
  /** #2 — déplace l'occurrence de ce mois à une autre date (ISO) sans toucher la série. */
  override_date?: string | null;
  created_at: string;
  updated_at: string;
}

/** Pré-épargne / pré-investissement : cumul « mental » par utilisateur et par type. */
export type PreSavingType = 'epargne' | 'invest';

export interface PreSavingEntry {
  date: string;
  montant: number;
  note?: string;
}

export interface PreSaving {
  id: string;
  profile_id: string;
  type: PreSavingType;
  total_cumule: number;
  entrees: PreSavingEntry[];
  statut: 'actif' | 'en_depassement';
  updated_at: string;
}

/** Réservation « Conserver pour plus tard » : déduite du reste disponible tant que libere_at est null. */
export interface Reservation {
  id: string;
  profile_id: string;
  montant: number;
  libelle?: string | null;
  created_at: string;
  libere_at?: string | null;
}

/** Seuils de recommandations (singleton, éditable admin). */
export interface RecommendationSettings {
  id: string;
  seuil_reco_epargne: number;
  seuil_reco_invest: number;
  seuil_reco_plaisir: number;
  seuil_reco_conserver: number;
  /** Ordre de consommation des recos par mode de prudence (cascade de dépassement). */
  consumption_orders?: Record<'prudent' | 'equilibre' | 'dynamique', Array<'save' | 'invest' | 'enjoy' | 'keep'>>;
  /** Mode « Auto » : profil financier P1–P5 → mode de prudence. */
  auto_profile_map?: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5', 'prudent' | 'equilibre' | 'dynamique'>;
  updated_at?: string;
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
  first_payment_date?: string | null;
  current_accumulated?: number;
  allocation_type?: 'monthly' | 'date' | 'ponctuel';
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
  linked_account?: { name: string; type: string };
}
