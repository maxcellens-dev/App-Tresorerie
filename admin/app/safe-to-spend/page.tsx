'use client';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

const STEP_COLORS = [
  '#60a5fa', // bleu
  '#f59e0b', // orange
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#34d399', // vert
];

interface FormulaStep {
  label: string;
  formula: string;
  explanation: string;
  color: string;
}

const STEPS: FormulaStep[] = [
  {
    label: 'Étape 1 — Net restant du mois',
    formula: 'remaining_month_net = Σ transactions futures ce mois (recettes − dépenses)',
    explanation:
      'On additionne toutes les transactions planifiées après aujourd\'hui dans le mois courant : recettes (+) et dépenses (−). Cela inclut les charges fixes, les revenus récurrents et les prévisions.',
    color: STEP_COLORS[0],
  },
  {
    label: 'Étape 2 — Engagements mensuels',
    formula: 'committed = Σ projets actifs (allocation mensuelle) + Σ objectifs actifs (cible annuelle ÷ 12)',
    explanation:
      'Les engagements sont les montants réservés chaque mois pour alimenter les projets et objectifs en cours. Même s\'ils n\'ont pas encore été exécutés, ils sont comptabilisés car l\'utilisateur s\'est engagé à les verser.',
    color: STEP_COLORS[1],
  },
  {
    label: 'Étape 3 — Réservations même compte',
    formula: 'same_account_reserved = Σ (transactions passées × allocation) pour chaque projet source = destination',
    explanation:
      'Quand un projet épargne sur le même compte (ex. : réservation mentale), l\'argent reste physiquement sur le compte courant. On déduit les réservations passées pour ne pas les recompter comme disponibles.',
    color: STEP_COLORS[2],
  },
  {
    label: 'Étape 4 — Base à dépenser',
    formula: 'base = solde_courant + remaining_month_net − committed − same_account_reserved',
    explanation:
      'On part du solde réel du compte courant, on ajoute ce qui va encore entrer/sortir ce mois, et on retire tout ce qui est déjà engagé ou réservé. Ce montant représente ce qu\'il reste réellement disponible.',
    color: STEP_COLORS[3],
  },
  {
    label: 'Étape 5 — Application de la marge de sécurité',
    formula: 'à_dépenser = max(0, base × (1 − marge% ÷ 100))',
    explanation:
      'La marge de sécurité (configurable dans Paramètres, 10 % par défaut) est retenue sur la base pour constituer un coussin automatique. Le résultat ne peut jamais être négatif.',
    color: STEP_COLORS[4],
  },
];

export default function SafeToSpendAdmin() {
  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>À dépenser ou placer en sécurité</h1>
      <p style={{ color: COLORS.textSecondary, marginBottom: 32, lineHeight: 1.6 }}>
        Explication complète du calcul du montant « À dépenser ou placer en sécurité »
        affiché sur la page Pilotage de l&apos;app.
      </p>

      {/* ══════════ Formule résumée ══════════ */}
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 16,
          padding: 24,
          marginBottom: 32,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 12 }}>Formule résumée</h2>
        <pre
          style={{
            backgroundColor: COLORS.bg,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            lineHeight: 2,
            overflowX: 'auto',
            color: COLORS.textSecondary,
            margin: 0,
          }}
        >
{`  Solde courant
+ Transactions futures du mois (net)
− Engagements projets (allocation mensuelle)
− Engagements objectifs (cible annuelle ÷ 12)
− Réservations même-compte (passées)
─────────────────────────────────────────
= Base à dépenser
× (1 − marge de sécurité %)
─────────────────────────────────────────
= À dépenser ou placer en sécurité`}
        </pre>
      </div>

      {/* ══════════ Étapes détaillées ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Étapes détaillées</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
        {STEPS.map((step, i) => (
          <div
            key={i}
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 12,
              padding: 20,
              borderLeft: `4px solid ${step.color}`,
            }}
          >
            <div style={{ fontWeight: 700, color: step.color, marginBottom: 8, fontSize: 14 }}>
              {step.label}
            </div>
            <code
              style={{
                display: 'block',
                backgroundColor: COLORS.bg,
                border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                color: COLORS.text,
                marginBottom: 10,
              }}
            >
              {step.formula}
            </code>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.7, margin: 0 }}>
              {step.explanation}
            </p>
          </div>
        ))}
      </div>

      {/* ══════════ Variables d'entrée ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Variables d&apos;entrée</h2>
      <div style={{ overflowX: 'auto', marginBottom: 40 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
              <th style={thStyle}>Variable</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['solde_courant', 'Σ accounts(type=checking).balance', 'Somme des soldes de tous les comptes courants'],
              ['remaining_month_net', 'transactions (date > today, même mois)', 'Recettes − dépenses encore à venir ce mois'],
              ['committed_projects', 'Σ projects(active).monthly_allocation', 'Allocations mensuelles des projets actifs'],
              ['committed_objectives', 'Σ objectives(active).target_yearly / 12', 'Objectifs annuels ramenés au mois'],
              ['same_account_reserved', 'transactions passées × allocation', 'Réservations déjà effectuées (même compte)'],
              ['marge_sécurité', 'profiles.safety_margin_percent', 'Pourcentage configuré dans Paramètres (défaut 10 %)'],
            ].map(([variable, source, desc]) => (
              <tr key={variable} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#60a5fa' }}>{variable}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{source}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════ Exemple concret ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Exemple concret</h2>
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 40,
        }}
      >
        <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 2 }}>
          <p style={{ marginTop: 0 }}><strong style={{ color: COLORS.text }}>Données :</strong></p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            <li>Solde courant : <strong style={{ color: '#60a5fa' }}>4 500 €</strong></li>
            <li>Transactions futures ce mois : <strong style={{ color: COLORS.text }}>+2 800 €</strong> (salaire) − <strong style={{ color: COLORS.text }}>1 200 €</strong> (loyer, EDF…) = <strong>+1 600 €</strong></li>
            <li>Engagements projets : <strong style={{ color: '#22d3ee' }}>300 €</strong> /mois</li>
            <li>Engagements objectifs : <strong style={{ color: '#34d399' }}>200 €</strong> /mois</li>
            <li>Réservations même-compte : <strong style={{ color: '#a78bfa' }}>150 €</strong> (1 mois passé × 150 €)</li>
            <li>Marge de sécurité : <strong style={{ color: COLORS.text }}>10 %</strong></li>
          </ul>

          <p><strong style={{ color: COLORS.text }}>Calcul :</strong></p>
          <pre
            style={{
              backgroundColor: COLORS.bg,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 8,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.8,
              overflowX: 'auto',
              margin: 0,
            }}
          >
{`  4 500 + 1 600 − 300 − 200 − 150 = 5 450 €  (base)
  5 450 × (1 − 10/100) = 5 450 × 0.90
  = 4 905 €  → À dépenser ou placer en sécurité`}
          </pre>
        </div>
      </div>

      {/* ══════════ Interaction avec les recommandations ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Lien avec les recommandations</h2>
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <p style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.7, margin: 0 }}>
          Le montant « À dépenser » est le <strong style={{ color: COLORS.text }}>budget total</strong> que 
          le moteur de recommandation répartit entre épargner, investir, se faire plaisir et conserver.
          La répartition dépend du palier d&apos;épargne (critique / à renforcer / saine / confortable)
          et des modificateurs contextuels (tendance variables, santé courant, ratio investissement).
          <br /><br />
          Voir la page <a href="/recommendations" style={{ color: '#60a5fa' }}>Recommandations</a> pour 
          le détail des règles de répartition.
        </p>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 13,
  color: '#94a3b8',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
};
