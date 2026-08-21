/**
 * pilotageView — les CALCULS DÉRIVÉS de l'écran Pilotage, sans React.
 *
 * `lib/pilotageEngine` répond à « combien y a-t-il ? » (le moteur financier). Ce fichier-ci répond à
 * « qu'est-ce que l'écran en montre ? » : le Relyka tel qu'affiché, la phrase du point bas, les
 * listes des modaux de suivi, l'état d'installation. C'était jusqu'ici ~400 lignes au milieu du
 * composant, donc intestable — un chiffre faux ne se voyait qu'à l'œil, sur l'écran.
 *
 * Tout est PUR et l'horloge est injectable (`now`) : les bascules de mois et de journée s'écrivent
 * en test au lieu de se vérifier en voyageant dans le temps.
 *
 * Cf. docs/PLAN_REFACTOR_TESTS.md, phase C2.
 */
import { CURRENCY_SYMBOL, floorToTen, convertAmount, type RatesMap } from './currency';
import { buildMaterializedIndex, recurrenceForMonth } from './recurrenceMonth';
import type { PilotageData } from './pilotageEngine';

/** « 24 juillet » — date lisible, pour situer le point bas de trésorerie dans le temps. */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** Montant arrondi en devise — usage hors des blocs de rendu qui définissent leur propre `fmt`. */
export function eur(n: number): string { return Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL; }

/** `2026-08` pour la date donnée (mois LOCAL, jamais UTC — cf. note `today-utc-vs-local`). */
function monthKeyOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Réservations « Conserver pour plus tard » : seulement celles du mois courant (remises à zéro
 * chaque mois). Une réservation d'un mois passé ne doit plus grever le Relyka d'aujourd'hui.
 */
export function monthReservationsTotal(
  reservations: Array<{ created_at?: string | null; montant: number | string }>,
  now: Date = new Date(),
): number {
  const monthKey = monthKeyOf(now);
  return reservations
    .filter((r) => (r.created_at ?? '').slice(0, 7) === monthKey)
    .reduce((s, r) => s + Number(r.montant), 0);
}

export interface RelykaBreakdown {
  cumulsTotal: number;
  safetyMarginDisplay: number;
  variableEnvelopeRemaining: number;
  savingsRemaining: number;
  investRemaining: number;
  monthExpensesPast: number;
  cashflowTrough: number;
  resteDisponibleBrut: number;
  resteDisponible: number;
  relykaAffiche: number;
  troughDate: string | null;
  nextIncomeDate: string | null;
  nextIncomeAmount: number;
  troughLimits: boolean;
  troughExplain: string;
  incomeIsGuessed: boolean;
  misDeCoteTotal: number;
  relykaAlloueVolontairement: boolean;
  baseADepenser: number;
  enDepassement: boolean;
}

/**
 * ── Reste disponible = Courant − tout ce qui est déjà promis ────────────────────────────────────
 *
 * Budget libre = POINT BAS de trésorerie d'ici la prochaine rentrée (revenus + dépenses réelles,
 * dans l'ordre des dates → on ne libère JAMAIS un revenu pas encore reçu). On en retire ensuite les
 * engagements volontaires (virements épargne/invest prévus, réservations), la marge et l'enveloppe
 * de dépenses variables estimée (qui, elle, n'est pas une transaction).
 *
 * Épargne / investissement : on ne déduit que la part FUTURE — la part déjà virée est par
 * construction déjà reflétée dans `current_checking_balance`, la recompter la retirerait deux fois.
 *
 * ⚠️ SOURCE UNIQUE de cette formule. Elle était écrite deux fois (ici et dans l'annonce du Relyka
 * après changement de mode d'enveloppe) : deux copies d'une soustraction à huit termes divergent au
 * premier ajout de terme, et l'écran annoncerait alors une variation qu'il n'affiche pas.
 */
export function computeRelykaBreakdown(
  pilotageData: PilotageData | null | undefined,
  ctx: { reservationsTotal: number; preEpargneTotal: number; preInvestTotal: number },
): RelykaBreakdown {
  const cumulsTotal = ctx.preEpargneTotal + ctx.preInvestTotal;
  const safetyMarginDisplay = pilotageData?.safety_margin_amount ?? 0;
  const variableEnvelopeRemaining = pilotageData?.variable_envelope_remaining ?? 0;
  const savingsRemaining = pilotageData?.month_savings_future ?? 0;
  const investRemaining = pilotageData?.month_invest_future ?? 0;
  // Les dépenses déjà passées sont déjà dans le solde courant → affichées en info uniquement.
  const monthExpensesPast = pilotageData?.month_expenses_past ?? 0;
  const cashflowTrough = pilotageData?.cashflow_trough ?? (pilotageData?.current_checking_balance ?? 0);

  /* Les cumuls manuels (pré-épargne / pré-invest) sont de l'argent « réservé mentalement » en
     attente de virement → on les retire aussi du budget libre tant qu'ils ne sont pas libérés ou
     transformés en virement (auquel cas ils repassent à 0 et sont déduits via les virements).
     Valeur BRUTE (peut être négative) : sert à savoir si le Relyka est à 0 par CHOIX (mises de côté)
     ou par manque d'argent — les deux méritent des messages opposés. */
  const resteDisponibleBrut =
    cashflowTrough
    - savingsRemaining
    - investRemaining
    - (pilotageData?.monthly_reserve_planned ?? 0)
    - ctx.reservationsTotal
    - cumulsTotal
    - variableEnvelopeRemaining
    - safetyMarginDisplay;
  const resteDisponible = Math.max(0, resteDisponibleBrut);
  /* Montant Relyka tel qu'AFFICHÉ (dizaine inférieure). C'est LUI qui décide de la couleur et du
     message, jamais le montant brut : entre 1 € et 9 €, la carte affichait « 0 € » tout en servant
     le message « utilise ton Relyka librement » en vert (ex. 154 € − 150 € réservés = 4 €). */
  const relykaAffiche = floorToTen(resteDisponible);

  /* ── Le point bas est une info À UNE DATE, pas un état permanent ────────────────────────────────
     Un salarié payé le 25 a mécaniquement un point bas faible le 24 : c'est normal, mais son Relyka
     ne concerne alors QUE la période d'ici là. Sans le dire, le chiffre paraît faux — et il remonte
     « tout seul » le lendemain de la paie, ce qui achève de casser la confiance. On expose donc la
     date du point bas et la rentrée qui le suit, dès que le point bas est réellement CONTRAIGNANT
     (c.-à-d. plus bas que le solde d'aujourd'hui : une dépense creuse le compte avant la rentrée). */
  const troughDate = pilotageData?.cashflow_trough_date ?? null;
  const nextIncomeDate = pilotageData?.next_income_date ?? null;
  const nextIncomeAmount = pilotageData?.next_income_amount ?? 0;
  const troughLimits =
    !!pilotageData && !!troughDate
    && cashflowTrough < (pilotageData.current_checking_balance ?? 0) - 1
    && (!nextIncomeDate || troughDate <= nextIncomeDate);
  const troughExplain = troughLimits
    ? `Le ${shortDay(troughDate)} : c'est le jour où ton solde sera au plus bas (${eur(cashflowTrough)}).`
      + (nextIncomeDate && nextIncomeAmount > 0
        ? ` Ta rentrée d'argent du ${shortDay(nextIncomeDate)} (+${eur(nextIncomeAmount)}) le fera remonter.`
        : '')
    : '';

  /* Revenu non déclaré en récurrent → le moteur l'INFÈRE et ne le compte que partiellement (pondéré
     par la prudence) : le Relyka est durablement sous-évalué. On le dit, avec l'action qui corrige. */
  const incomeIsGuessed = !!pilotageData && pilotageData.expected_income_source !== 'explicit';

  /* Tout ce que l'utilisateur a MIS DE CÔTÉ ce mois-ci et qu'il POSSÈDE ENCORE : épargne et
     investissement (déjà virés — donc déjà dans le point bas — ou seulement prévus), réservé de
     projet, réservations et cumuls. À distinguer de l'argent DÉPENSÉ, lui vraiment parti. */
  const misDeCoteTotal =
    (pilotageData?.month_savings_total ?? 0)
    + (pilotageData?.month_invest_total ?? 0)
    + (pilotageData?.monthly_reserve_planned ?? 0)
    + ctx.reservationsTotal
    + cumulsTotal;
  /* Le Relyka est à 0 parce que cet argent est RANGÉ AILLEURS, et non parce que l'utilisateur est à
     sec : on remet tout ce qu'il a mis de côté et on regarde s'il lui resterait quelque chose.
     Sans ce test, quelqu'un à −1 000 € qui a 100 € réservés lirait « rien d'inquiétant ». */
  const relykaAlloueVolontairement = misDeCoteTotal > 0 && resteDisponibleBrut + misDeCoteTotal > 0;

  const baseADepenser = pilotageData?.safe_to_spend ?? 0;
  const enDepassement = cumulsTotal > baseADepenser && baseADepenser > 0;

  return {
    cumulsTotal, safetyMarginDisplay, variableEnvelopeRemaining, savingsRemaining, investRemaining,
    monthExpensesPast, cashflowTrough, resteDisponibleBrut, resteDisponible, relykaAffiche,
    troughDate, nextIncomeDate, nextIncomeAmount, troughLimits, troughExplain, incomeIsGuessed,
    misDeCoteTotal, relykaAlloueVolontairement, baseADepenser, enDepassement,
  };
}

/**
 * TON du chiffre principal — la couleur du Relyka, décidée UNE fois.
 *
 * Deux corrections tiennent dans cette fonction :
 *
 *  1. La règle était recopiée à l'identique dans `usePilotageViewModel` ET dans l'écran Pilotage :
 *     deux expressions à quatre branches à garder synchronisées à la main.
 *
 *  2. Elle testait `relykaAffiche < 0` — une condition qui n'est JAMAIS vraie. `relykaAffiche`
 *     dérive de `Math.max(0, …)` : il vaut 0 au plus bas. Le rouge n'a donc jamais pu s'afficher,
 *     et quelqu'un réellement à −900 € voyait l'orange du « tout est déjà alloué », c'est-à-dire la
 *     couleur d'une situation normale. C'est le montant BRUT qui porte le signe : c'est lui qu'on
 *     interroge.
 *
 * Ordre volontaire : « mis de côté » (bleu) passe AVANT le rouge — si remettre ce qu'il a rangé
 * suffit à repasser dans le vert, il n'est pas dans le rouge, il a juste tout affecté.
 */
export type RelykaTone = 'positive' | 'allocated' | 'negative' | 'empty';

export function relykaTone(
  b: Pick<RelykaBreakdown, 'relykaAffiche' | 'relykaAlloueVolontairement' | 'resteDisponibleBrut'>,
): RelykaTone {
  if (b.relykaAffiche > 0) return 'positive';
  if (b.relykaAlloueVolontairement) return 'allocated';
  if (b.resteDisponibleBrut < 0) return 'negative';
  return 'empty';
}

/**
 * ── Message de BASE du Relyka : ce qu'EST le chiffre ────────────────────────────────────────────
 * Quand le Relyka est POSITIF, la phrase est passe-partout (« voici ce qu'il devrait te rester…
 * utilise-le librement ») : elle ne vaut que si elle est seule à l'écran — d'où `isGeneric`, que
 * `buildRelykaMessages` utilise pour l'effacer dès qu'un autre message a du concret à dire.
 * Les autres variantes QUALIFIENT le montant (budget dépassé, plus de marge, tout est rangé
 * ailleurs) : elles restent toujours affichées, en tête.
 */
export function buildRelykaBaseMessage(
  b: Pick<RelykaBreakdown, 'relykaAffiche' | 'relykaAlloueVolontairement' | 'misDeCoteTotal' | 'variableEnvelopeRemaining'>,
  relykaRangeIsRange: boolean,
): { text: string; isGeneric: boolean } {
  if (b.relykaAffiche < 0) {
    return { text: 'Budget dépassé ce mois-ci — mieux vaut lever le pied sur les dépenses.', isGeneric: false };
  }
  if (b.relykaAffiche <= 0) {
    // Relyka à 0 par CHOIX (réservations / cumuls) : c'est le geste qu'on a recommandé — on le
    // salue au lieu d'alerter. Sinon seulement, on met en garde.
    if (b.relykaAlloueVolontairement) {
      return {
        text: `Rien d'inquiétant : tu as mis ${Math.round(b.misDeCoteTotal).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL} de côté ce mois-ci (épargne, investissement, réservé).`,
        isGeneric: false,
      };
    }
    return {
      text: Math.round(Math.max(0, b.variableEnvelopeRemaining)) > 0
        ? 'Ton Relyka est épuisé - tout ton argent est alloué, donc reste prudent.'
        : 'Pas de marge — évite de dépenser avant ta prochaine rentrée d\'argent.',
      isGeneric: false,
    };
  }
  return {
    text: relykaRangeIsRange
      ? 'Voici ce qu\'il devrait te rester à la fin du mois. Tu peux suivre les recommandations — vérifie ton solde pour affiner l\'estimation.'
      : 'Voici ce qu\'il devrait te rester à la fin du mois. Utilise ton Relyka librement, idéalement en suivant les recommandations.',
    isGeneric: true,
  };
}

export interface SuiviDetail {
  checking: any[];
  savings: any[];
  invest: any[];
  spent: any[];
  recurrentes: any[];
  recurringTotal: number;
  recurringPassed: number;
}

/**
 * ── Détails du « Suivi du mois » (listes pour les modaux au clic, §3) ───────────────────────────
 *
 * Entrées déjà FILTRÉES par le périmètre quotidien (comme le moteur) : les modaux (dépenses,
 * épargne, investi, récurrentes) et le solde courant ne comptent QUE le périmètre du user.
 */
export function computeSuiviDetail(
  txForSuivi: any[],
  accountsForSuivi: any[],
  now: Date = new Date(),
): SuiviDetail {
  const accounts = accountsForSuivi;
  const txForConseils = txForSuivi;
  const monthPrefix = monthKeyOf(now);
  const todayStr = `${monthPrefix}-${String(now.getDate()).padStart(2, '0')}`;
  const typeById: Record<string, string> = {};
  accounts.forEach((a) => { typeById[a.id] = a.type; });
  const checkingIds = new Set(accounts.filter((a) => a.type === 'checking').map((a) => a.id));
  const inMonth = (d: string) => (d ?? '').slice(0, 7) === monthPrefix;

  const savings: any[] = [], invest: any[] = [], spent: any[] = [], recurrentes: any[] = [];
  for (const t of txForConseils as any[]) {
    const amt = Number(t.amount);
    const src = typeById[t.account_id];
    const linked = t.linked_account_id ? typeById[t.linked_account_id] : null;
    const draft = Boolean(t.is_draft);
    const recurring = Boolean(t.is_recurring) && Boolean(t.recurrence_rule);
    const isProjectDraft = draft && !!t.project_id;
    // Virements épargne / investissement du mois : récurrents + futurs + brouillons de projet
    // inclus (comme le total affiché), on exclut les « conservés »/réservés.
    if (amt < 0 && linked && (!draft || isProjectDraft) && !t.is_reserved && (recurring || inMonth(t.date))) {
      if (linked === 'investment' && (src === 'checking' || src === 'savings')) invest.push(t);
      else if (linked === 'savings' && src === 'checking') savings.push(t);
    }
    // Vraies dépenses depuis un compte courant (hors virements / projets / régul)
    if (!t.linked_account_id && !t.project_id && checkingIds.has(t.account_id) && !draft) {
      const cat = t.category;
      // « Dépensé ce mois » = dépenses (catégorie de dépense) et remboursements (montant positif
      // sur une catégorie de dépense). Les recettes (catégorie income) sont exclues — §1.
      const isExpenseOrRefund = !cat || cat.type === 'expense';
      // On NE doit PAS exclure les réguls : un « Solde initial » / « régularisation » qui RÉDUIT le
      // solde (négatif) compte comme dépensé — exactement comme « Total dépensé » (month_expenses_past).
      // Seul exclu : un régul qui AUGMENTE le solde (catégorie nulle, montant positif) → pas une dépense.
      const isNamedRegul = !!(cat?.name && /r[ée]gularisation|ajustement de solde/i.test(cat.name));
      const isNullCatIncome = !cat && amt > 0;
      const isInMonth = inMonth(t.date) && t.date <= todayStr;
      if (isExpenseOrRefund && !isNamedRegul && !isNullCatIncome) {
        // Récurrentes actives (template) → liste récurrentes (pour le modal plannifié)
        if (recurring && amt < 0) recurrentes.push(t);
        // Toute dépense/remboursement passé(e) dans le mois → liste spent (modal « Dépensé ce mois »)
        // Inclut les récurrentes matérialisées (plus marquées recurring après migration 030).
        if (isInMonth) spent.push(t);
      }
    }
  }
  const byDateDesc = (a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? '');

  // Récurrentes du mois : total projeté + part déjà passée (pour le curseur passé/total, §N5).
  // Le PASSÉ se lit sur les VRAIES lignes matérialisées, jamais déduit de l'ancre du modèle —
  // voir lib/recurrenceMonth (testé) pour le pourquoi et les cas limites.
  const y = now.getFullYear(), mo = now.getMonth() + 1;
  const daysInMonth = new Date(y, mo, 0).getDate();
  const materializedThisMonth = buildMaterializedIndex(txForConseils as any[], monthPrefix);
  const recurForMonth = (t: any) => recurrenceForMonth(t, materializedThisMonth, now);
  // On ne garde que les récurrences réellement actives CE mois (ex. une annuelle datée en juillet
  // ne compte pas en juin) → le modal et le curseur « dont récurrentes » affichent le même total.
  // `_monthTotal` / `_monthPassed` : montant projeté du mois et part déjà échue (pour griser les
  // occurrences à venir dans le modal et alimenter le filtre « À venir »).
  let recurringTotal = 0, recurringPassed = 0;
  const recurrentesApplicable: any[] = [];
  for (const t of recurrentes) {
    const r = recurForMonth(t);
    if (r.total <= 0) continue;
    recurringTotal += r.total;
    recurringPassed += r.passed;
    // Date d'occurrence DANS le mois courant (le template d'une récurrente échue est avancé au mois
    // suivant → sans ça le tri par date la renverrait tout en bas). Sert au tri ET à l'affichage.
    // Quand l'occurrence est matérialisée, on prend SA date réelle plutôt que le jour du modèle.
    const startDay = new Date((t.date ?? '').slice(0, 10) + 'T00:00:00').getDate() || 1;
    const monthDate = materializedThisMonth.get(t.id)?.lastDate
      ?? `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(startDay, daysInMonth)).padStart(2, '0')}`;
    recurrentesApplicable.push({ ...t, _monthTotal: r.total, _monthPassed: r.passed, _monthDate: monthDate });
  }

  // Virements épargne / invest : on ne garde que l'occurrence DU mois courant (date dans le mois).
  // Un template récurrent dont la date est avancée au mois suivant (occurrence de ce mois déjà
  // matérialisée et affichée à part) est ainsi exclu → cohérent avec le curseur « Épargné / Investi ».
  const transferAppliesThisMonth = (t: any) => inMonth(t.date);

  return {
    checking: accounts.filter((a) => a.type === 'checking'),
    savings: savings.filter(transferAppliesThisMonth).sort(byDateDesc),
    invest: invest.filter(transferAppliesThisMonth).sort(byDateDesc),
    spent: spent.sort(byDateDesc),
    recurrentes: recurrentesApplicable.sort((a, b) => (b._monthDate ?? '').localeCompare(a._monthDate ?? '')),
    recurringTotal,
    recurringPassed,
  };
}

/**
 * Récurrentes du mois PAS ENCORE passées (montant restant + nombre). Elles sortiront du compte
 * exactement comme les dépenses variables : la vue simplifiée les additionne donc sur la ligne
 * « Tu devrais encore dépenser », et son modal les détaille.
 */
export function computeRecurUpcoming(
  recurrentes: any[],
  accounts: any[],
  refCode: string,
  rates: RatesMap,
): { amount: number; count: number; list: any[] } {
  const curByAcc: Record<string, string> = {};
  accounts.forEach((a: any) => { curByAcc[a.id] = a.currency; });
  let amount = 0;
  const list: any[] = [];
  for (const t of recurrentes) {
    const left = Math.max(0, (t._monthTotal ?? 0) - (t._monthPassed ?? 0));
    if (left <= 0) continue;
    amount += convertAmount(left, curByAcc[t.account_id] || refCode, refCode, rates) ?? left;
    list.push({ ...t, _left: left });
  }
  return { amount, count: list.length, list };
}

export interface SetupState {
  hasRecurringTx: boolean;
  noAccountsYet: boolean;
  hasAnyTx: boolean;
  setupIncomplete: boolean;
  setupHint: string;
}

/**
 * ── Compte encore vide : un Relyka à 0 € doit DIRE POURQUOI ─────────────────────────────────────
 * Sur un compte neuf, « ce qu'il te reste à décider ce mois-ci » ne veut rien dire : il n'y a encore
 * rien à décider, et le chiffre à 0 passe pour une mauvaise nouvelle alors qu'il n'est qu'un calcul
 * sans données. On nomme la donnée manquante, et le geste qui la fournit.
 *
 * ⚠️ Une régularisation de solde n'est PAS une saisie de l'utilisateur : la création d'un compte
 * avec un solde en produit une, et elle ferait disparaître le message alors qu'il reste vrai.
 */
export function computeSetupState(
  accounts: any[],
  transactions: any[],
  relykaAffiche: number,
): SetupState {
  const hasRecurringTx = transactions.some((t) => t.is_recurring && t.recurrence_rule);
  const noAccountsYet = accounts.length === 0;
  const hasAnyTx = transactions.some(
    (t) => !(typeof t.note === 'string' && /r[ée]gularisation|ajustement de solde/i.test(t.note)),
  );
  return {
    hasRecurringTx,
    noAccountsYet,
    hasAnyTx,
    setupIncomplete: relykaAffiche <= 0 && (noAccountsYet || !hasRecurringTx),
    setupHint: noAccountsYet
      ? `Ton Relyka est à ${eur(0)} : il n'a encore rien à calculer. Crée tes comptes avec leur solde d'aujourd'hui pour le faire apparaître.`
      : `Ton Relyka est à ${eur(0)} : Relyka ne sait pas encore ce qui rentre ni ce qui part. Enregistre ta rentrée d'argent et tes charges fixes en récurrentes — il se calculera tout seul.`,
  };
}

/** Compte courant principal (solde le plus élevé) — cible du lien « Vérifier mon solde ». */
export function pickMainCheckingId(accounts: any[]): string | undefined {
  return [...accounts]
    .filter((a) => a.type === 'checking')
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id;
}
