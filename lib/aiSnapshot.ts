// Construit l'instantané financier ANONYMISÉ envoyé à l'IA (via l'Edge Function).
// Règle d'or : uniquement des MONTANTS et des CATÉGORIES (taxonomie générique). Jamais de nom, de
// libellé de transaction, de numéro de compte ou de nom de projet en clair → tout est neutralisé.
// L'instantané distingue explicitement les TYPES de mouvements (dépenses fixes/variables, virements
// épargne vs investissement) et donne le CONTEXTE temporel (jour du mois) et l'ancienneté des projets,
// pour que l'IA ne tire pas de conclusions erronées (peu de dépenses en début de mois = normal, etc.).
import type { PilotageData } from '../hooks/usePilotageData';

export interface SnapshotCredit { principal: number; monthly: number; ratePct: number; crd: number; endYM: string | null; impactPct: number }
export interface SnapshotProject { target: number; monthly: number; progressPct: number; startISO: string | null; status: string }

export interface SnapshotInput {
  currencySymbol: string;
  today: string;          // 'YYYY-MM-DD'
  dayOfMonth: number;
  daysInMonth: number;
  pilotage: PilotageData;
  /** Dépenses du mois par grande catégorie (déjà agrégées, triées desc). */
  expensesByCategory: Array<{ name: string; amount: number }>;
  credits?: SnapshotCredit[];
  projects?: SnapshotProject[];
}

const r0 = (n: number) => Math.round(n || 0).toLocaleString('fr-FR');

export function buildSnapshot(input: SnapshotInput): string {
  const { currencySymbol: s, today, dayOfMonth, daysInMonth, pilotage: p, expensesByCategory, credits = [], projects = [] } = input;
  const L: string[] = [];
  const m = (n: number) => `${r0(n)} ${s}`;
  const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);

  L.push('=== INSTANTANÉ FINANCIER (anonymisé : montants + catégories uniquement) ===');

  L.push('\nCONTEXTE TEMPOREL (important pour interpréter les chiffres)');
  L.push(`- Date du jour : ${today} — nous sommes le jour ${dayOfMonth}/${daysInMonth} du mois (≈ ${monthProgress}% du mois écoulé).`);
  L.push(`- ⚠ Les montants « du mois » sont donc partiels : en début de mois, peu de dépenses passées est NORMAL. Ne conclus pas à une baisse/hausse sur cette base.`);

  L.push('\nPATRIMOINE');
  L.push(`- Comptes courants : ${m(p.total_checking)}`);
  L.push(`- Épargne : ${m(p.total_savings)}`);
  L.push(`- Investissement : ${m(p.total_invested)}`);
  L.push(`- Patrimoine total : ${m(p.total_checking + p.total_savings + p.total_invested)}`);

  L.push('\nTRÉSORERIE');
  L.push(`- Reste à vivre estimé (« safe to spend ») : ${m(p.safe_to_spend)}`);
  L.push(`- Marge de sécurité conservée : ${m(p.safety_margin_amount)}`);
  L.push(`- Point bas projeté sur quelques mois : ${m(p.projection_min_buffer)}${p.projection_in_danger ? ' (⚠ tension de trésorerie)' : ''}`);
  L.push(`- Revenu mensuel estimé : ${m(p.expected_monthly_income)} (fiabilité ${Math.round(p.expected_income_confidence * 100)}%, source ${p.expected_income_source})`);
  L.push(`- Revenu mensuel moyen (6 mois) : ${m(p.avg_monthly_income)}`);

  L.push('\nDÉPENSES (hors virements internes)');
  L.push(`- Dépenses FIXES / engagements récurrents (par mois) : ${m(p.monthly_commitments)}`);
  L.push(`- Dépenses VARIABLES : moyenne 3 mois ${m(p.avg_variable_expenses_3m)} ; déjà engagées ce mois ${m(p.current_month_variable)} (au jour ${dayOfMonth}/${daysInMonth}).`);
  L.push(`- Total dépenses du mois (partiel) : ${m(p.month_expenses_total)} (déjà passées ${m(p.month_expenses_past)}, à venir ${m(p.month_expenses_remaining)}).`);
  if (expensesByCategory.length) {
    L.push('- Détail par grande catégorie (mois en cours, partiel) :');
    for (const c of expensesByCategory.slice(0, 12)) if (c.amount > 0) L.push(`  • ${c.name} : ${m(c.amount)}`);
  }

  L.push('\nVIREMENTS INTERNES (NE sont PAS des dépenses — ce sont des mises de côté)');
  L.push(`- Vers ÉPARGNE : ${m(p.monthly_savings_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_savings_excl_projects)}).`);
  L.push(`- Vers INVESTISSEMENT : ${m(p.monthly_invest_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_invest)}).`);
  L.push(`- Recommandation du moteur pour le surplus : ${p.recommendation} (surplus projeté ${m(p.projected_surplus)}).`);

  if (projects.length) {
    L.push(`\nPROJETS (${projects.length}) — la progression dépend de l'ANCIENNETÉ : un projet récent à faible % est NORMAL`);
    projects.forEach((pr, i) => {
      const age = pr.startISO ? monthsBetween(pr.startISO, today) : null;
      const ageTxt = age == null ? '' : age <= 0 ? ', démarré ce mois-ci' : `, démarré il y a ${age} mois`;
      L.push(`- Projet ${i + 1} : cible ${m(pr.target)}, ${m(pr.monthly)}/mois, ${Math.round(pr.progressPct)}% atteint${ageTxt} (${pr.status}).`);
    });
  }

  if (credits.length) {
    L.push(`\nCRÉDITS (${credits.length}) — tiens compte du % D'IMPACT (part réellement à ta charge)`);
    credits.forEach((cr, i) => {
      if (cr.impactPct <= 0) {
        L.push(`- Crédit ${i + 1} : impact 0 % → NE PÈSE PAS sur les finances de cet utilisateur (payé par quelqu'un d'autre). À IGNORER dans les conseils.`);
      } else {
        const share = cr.impactPct < 100 ? ` (part à sa charge : ${cr.impactPct} %)` : '';
        L.push(`- Crédit ${i + 1} : mensualité à sa charge ${m(cr.monthly)}${share}, capital restant dû ~${m(cr.crd)}, taux ${cr.ratePct} %${cr.endYM ? `, fin ${cr.endYM}` : ''}.`);
      }
    });
  }

  return L.join('\n');
}

function monthsBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00'); const b = new Date(toISO + 'T00:00:00');
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
