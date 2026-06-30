// Construit l'instantané financier ANONYMISÉ envoyé à l'IA (via l'Edge Function).
// Règle d'or : uniquement des MONTANTS et des CATÉGORIES (taxonomie générique). Jamais de nom, de
// libellé de transaction, de numéro de compte ou de nom de projet en clair → tout est neutralisé.
import type { PilotageData } from '../hooks/usePilotageData';

export interface SnapshotInput {
  currencySymbol: string;
  pilotage: PilotageData;
  /** Dépenses du mois par grande catégorie (déjà agrégées, triées desc). */
  expensesByCategory: Array<{ name: string; amount: number }>;
  /** Résumé des crédits (anonymisé). */
  credits?: Array<{ principal: number; monthly: number; ratePct: number; crd: number; endYM: string | null }>;
}

const r0 = (n: number) => Math.round(n || 0).toLocaleString('fr-FR');

export function buildSnapshot(input: SnapshotInput): string {
  const { currencySymbol: s, pilotage: p, expensesByCategory, credits = [] } = input;
  const L: string[] = [];
  const m = (n: number) => `${r0(n)} ${s}`;

  L.push('=== INSTANTANÉ FINANCIER (anonymisé : montants + catégories uniquement) ===');

  L.push('\nPATRIMOINE');
  L.push(`- Comptes courants : ${m(p.total_checking)}`);
  L.push(`- Épargne : ${m(p.total_savings)}`);
  L.push(`- Investissement : ${m(p.total_invested)}`);
  L.push(`- Patrimoine total : ${m(p.total_checking + p.total_savings + p.total_invested)}`);

  L.push('\nTRÉSORERIE DU MOIS');
  L.push(`- Reste à vivre estimé (« safe to spend ») : ${m(p.safe_to_spend)}`);
  L.push(`- Marge de sécurité conservée : ${m(p.safety_margin_amount)}`);
  L.push(`- Point bas projeté sur quelques mois : ${m(p.projection_min_buffer)}${p.projection_in_danger ? ' (⚠ tension de trésorerie)' : ''}`);
  L.push(`- Revenu mensuel estimé : ${m(p.expected_monthly_income)} (fiabilité ${Math.round(p.expected_income_confidence * 100)}%, source ${p.expected_income_source})`);
  L.push(`- Revenu mensuel moyen (6 mois) : ${m(p.avg_monthly_income)}`);

  L.push('\nDÉPENSES DU MOIS');
  L.push(`- Total : ${m(p.month_expenses_total)} (passées ${m(p.month_expenses_past)}, à venir ${m(p.month_expenses_remaining)})`);
  L.push(`- Dépenses variables — moyenne 3 mois : ${m(p.avg_variable_expenses_3m)}, ce mois : ${m(p.current_month_variable)} (tendance ${p.variable_trend_percentage >= 0 ? '+' : ''}${Math.round(p.variable_trend_percentage)}%)`);
  if (expensesByCategory.length) {
    L.push('- Par catégorie :');
    for (const c of expensesByCategory.slice(0, 12)) if (c.amount > 0) L.push(`  • ${c.name} : ${m(c.amount)}`);
  }

  L.push('\nÉPARGNE / INVESTISSEMENT');
  L.push(`- Épargne planifiée/mois : ${m(p.monthly_savings_planned)} (réalisée ${m(p.real_savings_excl_projects)})`);
  L.push(`- Investissement planifié/mois : ${m(p.monthly_invest_planned)} (réalisé ${m(p.real_invest)})`);
  L.push(`- Recommandation du moteur : ${p.recommendation} (surplus projeté ${m(p.projected_surplus)})`);

  if (p.projects_with_progress?.length) {
    L.push(`\nPROJETS (${p.projects_with_progress.length})`);
    p.projects_with_progress.forEach((pr, i) =>
      L.push(`- Projet ${i + 1} : cible ${m(pr.target_amount)}, ${m(pr.monthly_allocation)}/mois, ${Math.round(pr.progress_percentage)}% atteint (${pr.status})`));
  }

  if (p.objectives_with_progress?.length) {
    L.push(`\nOBJECTIFS D'INVESTISSEMENT (${p.objectives_with_progress.length})`);
    p.objectives_with_progress.forEach((o, i) =>
      L.push(`- Objectif ${i + 1} : cible annuelle ${m(o.target_yearly_amount)}, investi cette année ${m(o.current_year_invested)} (${Math.round(o.progress_percentage)}%)`));
  }

  if (credits.length) {
    L.push(`\nCRÉDITS (${credits.length})`);
    credits.forEach((cr, i) =>
      L.push(`- Crédit ${i + 1} : capital ${m(cr.principal)}, mensualité ${m(cr.monthly)}, taux ${cr.ratePct}%, capital restant dû ~${m(cr.crd)}${cr.endYM ? `, fin ${cr.endYM}` : ''}`));
  }

  return L.join('\n');
}
