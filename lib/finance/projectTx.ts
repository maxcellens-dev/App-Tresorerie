/**
 * Projets personnels — mode de financement et transactions générées.
 *
 * Trois modes (choisis à la création, FIGÉS ensuite — cf. migration 139) :
 *   • 'transfer' — « Mettre de côté »          : virements en BROUILLON du compte source vers un
 *                                                compte épargne/investissement (à valider un par un).
 *   • 'reserve'  — « Conserver pour plus tard » : brouillon RÉSERVÉ sur le même compte (aucun
 *                                                virement réel ; le montant sort du budget libre).
 *   • 'spend'    — « Dépenser petit à petit »   : de VRAIES dépenses catégorisées, validées d'emblée
 *                                                (elles comptent comme n'importe quelle dépense).
 *
 * Ce module est PUR (aucun accès réseau) : il est partagé par les hooks (création/mise à jour d'un
 * projet, suppression d'une échéance) et par les moteurs (pilotage, trésorerie, projection).
 */

export type ProjectMode = 'transfer' | 'reserve' | 'spend';

/**
 * Mode d'un projet. Repli déduit des comptes pour les projets créés AVANT la migration 139
 * (même compte source/destination = réservation, sinon virement).
 */
export function projectMode(p: any): ProjectMode {
  const m = p?.mode;
  if (m === 'transfer' || m === 'reserve' || m === 'spend') return m;
  return p?.source_account_id && p.source_account_id === p.linked_account_id ? 'reserve' : 'transfer';
}

/**
 * Transaction d'un projet « Dépenser petit à petit » : une VRAIE dépense (un seul compte, une
 * catégorie), à distinguer d'un virement de projet (linked_account_id) et d'une réservation
 * (is_reserved). Les moteurs doivent la traiter comme n'importe quelle dépense — et surtout PAS
 * comme un « mouvement projet », sinon elle serait comptée deux fois (ou pas du tout).
 */
export function isProjectSpendTx(t: any): boolean {
  return !!t?.project_id && !t?.linked_account_id && !t?.is_reserved && Number(t?.amount ?? 0) < 0;
}

export interface ProjectTxInput {
  profileId: string;
  projectId: string;
  projectName: string;
  mode: ProjectMode;
  /** Montant POSITIF de l'échéance. */
  amount: number;
  date: string;
  /** Compte source ('transfer'/'reserve') ou compte où tombent les dépenses ('spend'). */
  accountId: string | null;
  /** Compte de destination — mode 'transfer' uniquement. */
  linkedAccountId: string | null;
  /** Catégorie « Projets » du profil (mode 'reserve'). */
  projetsCategoryId: string | null;
  /** Catégorie de dépense choisie par l'utilisateur (mode 'spend'). */
  expenseCategoryId: string | null;
  /** Date du jour LOCALE (YYYY-MM-DD) — sert à poser `posted` sur les dépenses déjà échues. */
  today: string;
}

/**
 * Construit les lignes de transaction d'UNE échéance de projet (rien n'est inséré ici).
 * Une seule ligne dans tous les cas : la jambe de crédit d'un virement n'est créée qu'à la
 * validation du brouillon (cf. useValidateProjectDraft).
 */
export function buildProjectTransactions(o: ProjectTxInput): any[] {
  const base = {
    profile_id: o.profileId,
    date: o.date,
    is_forecast: false,
    is_recurring: false,
    recurrence_rule: null,
    recurrence_end_date: null,
    project_id: o.projectId,
  };

  if (o.mode === 'spend') {
    if (!o.accountId) return [];
    // Dépense RÉELLE : validée d'emblée, catégorisée. `posted` ne passe à true que le jour venu
    // (une dépense datée dans le futur ne doit pas bouger le solde aujourd'hui — reconcile_posted
    // la portera au solde à sa date).
    return [{
      ...base,
      account_id: o.accountId,
      category_id: o.expenseCategoryId,
      linked_account_id: null,
      amount: -o.amount,
      note: o.projectName,
      is_draft: false,
      is_reserved: false,
      posted: o.date <= o.today,
    }];
  }

  if (o.mode === 'reserve') {
    if (!o.accountId) return [];
    // Réservation pure : brouillon « Conservé » d'office sur le compte (jamais porté au solde).
    return [{
      ...base,
      account_id: o.accountId,
      category_id: o.projetsCategoryId,
      amount: -o.amount,
      note: `🔒 ${o.projectName}`,
      is_draft: true,
      is_reserved: true,
      posted: false,
    }];
  }

  // 'transfer' — brouillon de VIREMENT (linked_account_id renseigné), pas une dépense :
  // le crédit sur le compte de destination est créé à la validation.
  if (!o.accountId) return [];
  return [{
    ...base,
    account_id: o.accountId,
    category_id: null,
    linked_account_id: o.linkedAccountId,
    amount: -o.amount,
    note: o.projectName,
    is_draft: true,
    posted: false,
  }];
}
