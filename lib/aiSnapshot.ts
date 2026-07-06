// Construit l'instantané financier ANONYMISÉ envoyé à l'IA (via l'Edge Function).
// Règle d'or : uniquement des MONTANTS et des CATÉGORIES (taxonomie générique). Jamais de nom, de
// libellé de transaction, de numéro de compte ou de nom de projet en clair → tout est neutralisé.
// L'instantané distingue explicitement les TYPES de mouvements (dépenses fixes/variables, virements
// épargne vs investissement) et donne le CONTEXTE temporel (jour du mois) et l'ancienneté des projets,
// pour que l'IA ne tire pas de conclusions erronées (peu de dépenses en début de mois = normal, etc.).
//
// V2 — sections ajoutées pour des conseils réellement personnalisés :
//   • RATIOS CLÉS pré-calculés (taux d'épargne, poids des fixes/crédits, coussin de sécurité) ;
//   • HISTORIQUE MENSUEL (mois COMPLETS : revenus / dépenses fixes / variables) → tendances fiables ;
//   • MOYENNES PAR CATÉGORIE (3 mois complets) + dernier mois complet + dérive % ;
//   • CHARGES RÉCURRENTES actives par sous-catégorie (abonnements/engagements à passer en revue) ;
//   • REVENUS RÉCURRENTS ;
//   • DÉPENSES PONCTUELLES NOTABLES (grosses dépenses non récurrentes récentes).
import type { PilotageData } from '../hooks/usePilotageData';

export interface SnapshotCredit { principal: number; monthly: number; ratePct: number; crd: number; endYM: string | null; impactPct: number; remainingMonths?: number | null }
export interface SnapshotProject { target: number; monthly: number; progressPct: number; startISO: string | null; status: string }
/** Un mois COMPLET d'historique (YYYY-MM) : revenus / dépenses (hors virements internes). */
export interface SnapshotMonth { ym: string; income: number; expenses: number; fixed: number; variable: number }
/** Tendance d'une grande catégorie : moyenne mensuelle (3 mois complets) vs dernier mois complet. */
export interface SnapshotCategoryTrend { name: string; avg3m: number; lastMonth: number }
/** Charge (ou revenu) récurrente active : sous-catégorie + montant + fréquence. */
export interface SnapshotRecurring { category: string; amount: number; rule: string }
/** Dépense ponctuelle notable (non récurrente) : date + grande catégorie + montant. */
export interface SnapshotOneOff { date: string; category: string; amount: number }
/** Projection du solde courant en fin de mois (moteur lib/forecast — le même que l'onglet Projection). */
export interface SnapshotForecastMonth { ym: string; balance: number }

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
  /** Historique par mois COMPLET (du plus ancien au plus récent, ≤ 6). */
  history?: SnapshotMonth[];
  /** Tendances par grande catégorie (triées par moyenne desc). */
  categoryTrends?: SnapshotCategoryTrend[];
  /** Charges récurrentes actives (dépenses), triées desc. */
  recurringExpenses?: SnapshotRecurring[];
  /** Revenus récurrents actifs. */
  recurringIncomes?: SnapshotRecurring[];
  /** Grosses dépenses ponctuelles récentes (~8 max). */
  topOneOff?: SnapshotOneOff[];
  /** Projection du solde courant sur ~6 mois (mois courant inclus). */
  forecast?: SnapshotForecastMonth[];
}

const r0 = (n: number) => Math.round(n || 0).toLocaleString('fr-FR');
const RULE_FR: Record<string, string> = { daily: 'jour', weekly: 'semaine', monthly: 'mois', yearly: 'an', quarterly: 'trimestre' };
// Équivalent MENSUEL d'une récurrence (pour totaliser des récurrents de fréquences différentes).
const RULE_MONTHLY: Record<string, number> = { daily: 30.4, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const monthlyEq = (r: SnapshotRecurring) => r.amount * (RULE_MONTHLY[r.rule] ?? 1);

export function buildSnapshot(input: SnapshotInput): string {
  const {
    currencySymbol: s, today, dayOfMonth, daysInMonth, pilotage: p, expensesByCategory,
    credits = [], projects = [], history = [], categoryTrends = [],
    recurringExpenses = [], recurringIncomes = [], topOneOff = [], forecast = [],
  } = input;
  const L: string[] = [];
  const m = (n: number) => `${r0(n)} ${s}`;
  const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);

  L.push('=== INSTANTANÉ FINANCIER (anonymisé : montants + catégories uniquement) ===');

  L.push('\nCONTEXTE TEMPOREL (important pour interpréter les chiffres)');
  L.push(`- Date du jour : ${today} — nous sommes le jour ${dayOfMonth}/${daysInMonth} du mois (≈ ${monthProgress}% du mois écoulé).`);
  L.push(`- ⚠ Les montants « du mois » sont donc partiels : en début de mois, peu de dépenses passées est NORMAL. Pour les tendances, appuie-toi sur l'HISTORIQUE des mois complets et les moyennes.`);

  L.push('\nPATRIMOINE');
  L.push(`- Comptes courants : ${m(p.total_checking)}`);
  L.push(`- Épargne : ${m(p.total_savings)}`);
  L.push(`- Investissement : ${m(p.total_invested)}`);
  L.push(`- Patrimoine total : ${m(p.total_checking + p.total_savings + p.total_invested)}`);

  // Ratios pré-calculés côté app (fiables — préfère-les à tes propres recalculs).
  // Revenu de RÉFÉRENCE = le plus représentatif entre le revenu déclaré/inféré et le total des revenus
  // récurrents actifs (un « revenu estimé » déclaré peut être partiel ; une moyenne peut être gonflée
  // par une rentrée exceptionnelle).
  const recurringIncomeMonthly = recurringIncomes.reduce((t, r) => t + monthlyEq(r), 0);
  const income = Math.max(p.expected_monthly_income || 0, recurringIncomeMonthly) || p.avg_monthly_income || 0;
  const incomeBase = income === recurringIncomeMonthly && recurringIncomeMonthly > 0 ? 'total des revenus récurrents actifs'
    : income === p.expected_monthly_income ? 'revenu mensuel estimé' : 'revenu mensuel moyen';
  const plannedSetAside = (p.monthly_savings_planned || 0) + (p.monthly_invest_planned || 0);
  const creditMonthly = credits.reduce((t, cr) => t + (cr.impactPct > 0 ? cr.monthly : 0), 0);
  // Dépenses FIXES de référence = total des charges récurrentes actives normalisées au mois.
  // (`monthly_commitments` du pilotage = allocations de projets, PAS les dépenses fixes.)
  const fixedMonthly = recurringExpenses.reduce((t, r) => t + monthlyEq(r), 0);
  const avgExpenses = history.length
    ? history.reduce((t, h) => t + h.expenses, 0) / history.length
    : fixedMonthly + (p.avg_variable_expenses_3m || 0);
  L.push('\nRATIOS CLÉS (pré-calculés — fiables)');
  if (income > 0) {
    L.push(`- Revenu de référence utilisé pour ces ratios : ${m(income)}/mois (base : ${incomeBase}). Tout pourcentage que tu cites doit être cohérent avec CE montant.`);
    L.push(`- Taux de mise de côté planifié (épargne + investissement) : ${Math.round((plannedSetAside / income) * 100)} % du revenu.`);
    if (fixedMonthly > 0) L.push(`- Poids des dépenses fixes (total des charges récurrentes actives, ~${m(fixedMonthly)}/mois) : ${Math.round((fixedMonthly / income) * 100)} % du revenu.`);
    if (creditMonthly > 0) L.push(`- Poids des crédits (mensualités à charge, assurance incluse) : ${Math.round((creditMonthly / income) * 100)} % du revenu.`);
  }
  if (avgExpenses > 0) L.push(`- Coussin de sécurité : l'épargne couvre ~${(p.total_savings / avgExpenses).toFixed(1)} mois de dépenses (moyenne ${m(avgExpenses)}/mois).`);

  L.push('\nTRÉSORERIE');
  L.push(`- Reste à vivre estimé (« safe to spend ») : ${m(p.safe_to_spend)} — déjà NET de la marge de sécurité ci-dessous : ce montant est réellement disponible (ce n'est PAS un signe de tension).`);
  L.push(`- Marge de sécurité conservée EN PLUS (non comprise dans le reste à vivre) : ${m(p.safety_margin_amount)}`);
  L.push(`- Point bas projeté sur quelques mois : ${m(p.projection_min_buffer)}${p.projection_in_danger ? ' (⚠ tension de trésorerie)' : ''}`);
  L.push(`- Revenu mensuel estimé : ${m(p.expected_monthly_income)} (fiabilité ${Math.round(p.expected_income_confidence * 100)}%, source ${p.expected_income_source})`);
  L.push(`- Revenu mensuel moyen (6 mois) : ${m(p.avg_monthly_income)}`);
  if (recurringIncomeMonthly > 0) {
    L.push(`- ⚠ Ces indicateurs de revenu peuvent différer entre eux (déclaration partielle, rentrée exceptionnelle dans la moyenne…). La référence de train de vie = le revenu de référence des RATIOS CLÉS. Un écart entre indicateurs n'est PAS une priorité d'action : au plus une phrase.`);
  }

  if (forecast.length > 1) {
    const first = forecast[0].balance;
    const last = forecast[forecast.length - 1].balance;
    const minF = Math.min(...forecast.map((f) => f.balance));
    L.push('\nPROJECTION DU SOLDE COURANT (fin de mois — moteur de l\'app : récurrentes + variables estimées + mises de côté prévues déjà comptées)');
    L.push('- ' + forecast.map((f) => `${f.ym} : ${m(f.balance)}`).join(' · '));
    if (last < first - 1 || minF < 0) {
      L.push(`- ⚠ Le solde projeté ${minF < 0 ? 'passe en NÉGATIF' : 'BAISSE sur la période'} : ne recommande PAS de virement automatique mensuel supplémentaire — préfère des allocations PONCTUELLES décidées mois par mois, et explique pourquoi.`);
    } else {
      L.push('- Le solde projeté tient sur la période : des mises de côté régulières sont envisageables dans la limite du surplus.');
    }
  }

  if (history.length) {
    L.push(`\nHISTORIQUE MENSUEL (${history.length} mois COMPLETS — la référence pour les tendances)`);
    for (const h of history) {
      L.push(`- ${h.ym} : revenus ${m(h.income)}, dépenses ${m(h.expenses)} (fixes ${m(h.fixed)} / variables ${m(h.variable)})${h.income > 0 ? `, solde ${h.income - h.expenses >= 0 ? '+' : ''}${r0(h.income - h.expenses)} ${s}` : ''}.`);
    }
  }

  L.push('\nDÉPENSES (hors virements internes)');
  if (fixedMonthly > 0) L.push(`- Dépenses FIXES / engagements récurrents : ~${m(fixedMonthly)}/mois (total des charges récurrentes actives listées plus bas).`);
  {
    // Rythme des variables : signal explicite pour éviter le contresens « 648 € au jour 6 = dans la
    // moyenne » (la moyenne est MENSUELLE ; dépassée dès le début du mois = alerte, pas normalité).
    const avgVar = p.avg_variable_expenses_3m || 0;
    const spentVar = p.current_month_variable || 0;
    let paceTxt = '';
    if (avgVar > 0 && spentVar >= avgVar && dayOfMonth < daysInMonth - 3) {
      paceTxt = ` — ⚠ la moyenne MENSUELLE est DÉJÀ atteinte/dépassée au jour ${dayOfMonth} : c'est un dépassement net, pas « dans la moyenne »`;
    } else if (avgVar > 0 && dayOfMonth >= 5) {
      const pace = (spentVar / dayOfMonth) * daysInMonth;
      const delta = Math.round(((pace - avgVar) / avgVar) * 100);
      paceTxt = ` — rythme projeté ≈ ${m(pace)} sur le mois (${delta >= 0 ? '+' : ''}${delta} % vs moyenne, indicatif en début de mois)`;
    }
    L.push(`- Dépenses VARIABLES : moyenne 3 mois ${m(avgVar)}/mois ; déjà engagées ce mois ${m(spentVar)} au jour ${dayOfMonth}/${daysInMonth}${paceTxt}.`);
  }
  L.push(`- Total dépenses du mois (partiel) : ${m(p.month_expenses_total)} (déjà passées ${m(p.month_expenses_past)}, à venir ${m(p.month_expenses_remaining)}).`);
  if (expensesByCategory.length) {
    L.push('- Détail par grande catégorie (mois en cours, partiel) :');
    for (const c of expensesByCategory.slice(0, 12)) if (c.amount > 0) L.push(`  • ${c.name} : ${m(c.amount)}`);
  }

  if (categoryTrends.length) {
    L.push('\nMOYENNES PAR GRANDE CATÉGORIE (mois COMPLETS — base solide pour repérer les postes lourds et les dérives)');
    for (const t of categoryTrends.slice(0, 12)) {
      const drift = t.avg3m > 0 ? Math.round(((t.lastMonth - t.avg3m) / t.avg3m) * 100) : 0;
      const driftTxt = Math.abs(drift) >= 10 ? ` (${drift > 0 ? '+' : ''}${drift} % vs moyenne)` : '';
      L.push(`- ${t.name} : moyenne ${m(t.avg3m)}/mois ; dernier mois complet ${m(t.lastMonth)}${driftTxt}.`);
    }
  }

  if (recurringExpenses.length) {
    L.push(`\nCHARGES RÉCURRENTES ACTIVES (${recurringExpenses.length}) — engagements réguliers. NB : une ligne « Autres / Divers / Frais variables » est une ENVELOPPE de dépenses courantes, pas un abonnement résiliable.`);
    for (const r of recurringExpenses.slice(0, 20)) L.push(`- ${r.category} : ${m(r.amount)}/${RULE_FR[r.rule] ?? r.rule}`);
  }
  if (recurringIncomes.length) {
    L.push(`\nREVENUS RÉCURRENTS ACTIFS — total ≈ ${m(recurringIncomeMonthly)}/mois`);
    for (const r of recurringIncomes.slice(0, 8)) L.push(`- ${r.category} : ${m(r.amount)}/${RULE_FR[r.rule] ?? r.rule}`);
  }

  if (topOneOff.length) {
    L.push('\nDÉPENSES PONCTUELLES NOTABLES (récentes, non récurrentes — contexte, pas forcément un problème)');
    for (const t of topOneOff.slice(0, 8)) L.push(`- ${t.date} · ${t.category} : ${m(t.amount)}`);
  }

  L.push('\nVIREMENTS INTERNES (NE sont PAS des dépenses — ce sont des mises de côté)');
  L.push(`- Vers ÉPARGNE : ${m(p.monthly_savings_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_savings_excl_projects)}).`);
  L.push(`- Vers INVESTISSEMENT : ${m(p.monthly_invest_planned)}/mois prévus (déjà réalisés ce mois ${m(p.real_invest)}).`);
  L.push(`- Recommandation du moteur pour le surplus : ${p.recommendation} (surplus projeté ${m(p.projected_surplus)}).`);
  if (p.allocation_save_percent != null || p.allocation_invest_percent != null) {
    L.push(`- Répartition du surplus paramétrée par l'utilisateur : épargne ${Math.round(p.allocation_save_percent ?? 0)} % / investissement ${Math.round(p.allocation_invest_percent ?? 0)} % (le reste = confort/libre). Pars de cette répartition, ne l'invente pas.`);
  }

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
        const rem = cr.remainingMonths != null && cr.remainingMonths > 0 ? `, ${cr.remainingMonths} mensualités restantes` : '';
        L.push(`- Crédit ${i + 1} : mensualité à sa charge ${m(cr.monthly)}${share}, capital restant dû ~${m(cr.crd)}, taux ${cr.ratePct} %${rem}${cr.endYM ? `, fin ${cr.endYM}` : ''}.`);
      }
    });
  }

  // Limites AUTO-DÉTECTÉES des données : calibre la prudence de l'IA et lui permet de suggérer les
  // bons gestes DANS L'APP (catégoriser, marquer une récurrente…) plutôt que des conseils bancals.
  const limits: string[] = [];
  if (history.length > 0 && history.length < 3) limits.push(`Historique court (${history.length} mois complet${history.length > 1 ? 's' : ''}) : ne parle de « tendance » qu'avec beaucoup de prudence.`);
  if (income > 0) {
    for (const h of history) {
      if (h.income > income * 2.5) limits.push(`Le mois ${h.ym} contient des rentrées exceptionnelles (${m(h.income)}) : événement PONCTUEL, pas une tendance — ne bâtis pas de conseil récurrent dessus.`);
    }
  }
  const uncat = categoryTrends.find((t) => t.name === 'Sans catégorie');
  if (uncat && uncat.avg3m >= 30) limits.push(`~${m(uncat.avg3m)}/mois de dépenses NON CATÉGORISÉES : les analyses par poste sont incomplètes — suggère de les catégoriser dans l'app.`);
  if (recurringExpenses.length === 0 && avgExpenses > 0) limits.push(`Aucune charge récurrente n'est marquée dans l'app : le poids réel des dépenses fixes est INCONNU — ne conclus pas à leur absence ; suggère de marquer les dépenses récurrentes.`);
  if (limits.length) {
    L.push('\nLIMITES DES DONNÉES (à respecter, sans en faire un paragraphe)');
    for (const x of limits) L.push(`- ${x}`);
  }

  return L.join('\n');
}

function monthsBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00'); const b = new Date(toISO + 'T00:00:00');
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
