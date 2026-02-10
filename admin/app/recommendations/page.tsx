'use client';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

/* ── Couleurs par type de recommandation ── */
const RECO_COLORS: Record<string, string> = {
  save: '#34d399',
  invest: '#a78bfa',
  enjoy: '#f59e0b',
  keep: '#60a5fa',
};

const RECO_LABELS: Record<string, string> = {
  save: 'Épargner',
  invest: 'Investir',
  enjoy: 'Se faire plaisir',
  keep: 'Conserver',
};

const RECO_ICONS: Record<string, string> = {
  save: '🛡️',
  invest: '📈',
  enjoy: '✨',
  keep: '⏳',
};

/* ── Paliers d'épargne ── */
const TIERS = [
  {
    key: 'critical',
    label: 'Critique',
    condition: 'Épargne < seuil minimum',
    color: '#ef4444',
    alloc: { save: 60, invest: 0, enjoy: 10, keep: 30 },
  },
  {
    key: 'below_optimal',
    label: 'À renforcer',
    condition: 'Minimum ≤ épargne < optimal',
    color: '#f59e0b',
    alloc: { save: 40, invest: 15, enjoy: 20, keep: 25 },
  },
  {
    key: 'healthy',
    label: 'Saine',
    condition: 'Optimal ≤ épargne < confort',
    color: '#34d399',
    alloc: { save: 15, invest: 35, enjoy: 30, keep: 20 },
  },
  {
    key: 'comfortable',
    label: 'Confortable',
    condition: 'Épargne ≥ seuil de confort',
    color: '#34d399',
    alloc: { save: 10, invest: 45, enjoy: 30, keep: 15 },
  },
];

/* ── Modificateurs contextuels ── */
const MODIFIERS = [
  {
    name: 'Tendance dépenses variables',
    desc: 'Si la tendance des dépenses variables > 120 %, on réduit « Se faire plaisir » et on augmente « Conserver ». Inversement si < 80 %.',
    icon: '📊',
  },
  {
    name: 'Santé du compte courant',
    desc: 'Si le solde courant est < 2× les engagements mensuels (projets + objectifs + charges fixes), on augmente « Conserver » de 10 pp.',
    icon: '🏦',
  },
  {
    name: 'Ratio investissement/épargne',
    desc: 'Si le total investi est < 15 % de l\'épargne totale, on augmente « Investir » de 8 pp pour encourager la diversification.',
    icon: '⚖️',
  },
];

export default function RecommendationsAdmin() {
  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Recommandations intelligentes</h1>
      <p style={{ color: COLORS.textSecondary, marginBottom: 32, lineHeight: 1.6 }}>
        Le moteur analyse la santé financière de l&apos;utilisateur et propose 2 à 4 actions
        dont la somme fait 100 % du « À dépenser ou placer en sécurité ».
      </p>

      {/* ══════════ Types de recommandation ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Types de recommandation</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 40,
        }}
      >
        {(['save', 'invest', 'enjoy', 'keep'] as const).map((type) => (
          <div
            key={type}
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 12,
              padding: 16,
              borderLeft: `4px solid ${RECO_COLORS[type]}`,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{RECO_ICONS[type]}</div>
            <div style={{ fontWeight: 700, color: RECO_COLORS[type], marginBottom: 4 }}>
              {RECO_LABELS[type]}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5 }}>
              {type === 'save' && 'Transférer vers l\'épargne de sécurité. Prioritaire quand les réserves sont basses.'}
              {type === 'invest' && 'Alimenter un objectif d\'investissement. Prioritaire quand l\'épargne est confortable.'}
              {type === 'enjoy' && 'Budget dépenses variables et loisirs. Toujours présent (10-30 %).'}
              {type === 'keep' && 'Conserver sur le compte courant comme réserve. Augmente si le solde est tendu.'}
            </div>
            <div
              style={{
                marginTop: 12,
                padding: '4px 10px',
                backgroundColor: RECO_COLORS[type] + '15',
                borderRadius: 6,
                display: 'inline-block',
                fontSize: 12,
                color: RECO_COLORS[type],
                fontWeight: 600,
              }}
            >
              {type === 'save' && 'Action → Comptes (transfert)'}
              {type === 'invest' && 'Action → Objectifs'}
              {type === 'enjoy' && 'Action → Informatif'}
              {type === 'keep' && 'Action → Informatif'}
            </div>
          </div>
        ))}
      </div>

      {/* ══════════ Paliers d'allocation ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Paliers d&apos;allocation</h2>
      <p style={{ color: COLORS.textSecondary, marginBottom: 16, fontSize: 14 }}>
        Les pourcentages de base sont déterminés par le niveau d&apos;épargne de l&apos;utilisateur,
        puis ajustés par les modificateurs contextuels.
      </p>

      <div style={{ overflowX: 'auto', marginBottom: 40 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
              <th style={thStyle}>Palier</th>
              <th style={thStyle}>Condition</th>
              <th style={{ ...thStyle, color: RECO_COLORS.save }}>🛡️ Épargner</th>
              <th style={{ ...thStyle, color: RECO_COLORS.invest }}>📈 Investir</th>
              <th style={{ ...thStyle, color: RECO_COLORS.enjoy }}>✨ Plaisir</th>
              <th style={{ ...thStyle, color: RECO_COLORS.keep }}>⏳ Conserver</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr
                key={tier.key}
                style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}
              >
                <td style={tdStyle}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: tier.color,
                      marginRight: 8,
                    }}
                  />
                  <strong>{tier.label}</strong>
                </td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{tier.condition}</td>
                <td style={tdStyle}>{tier.alloc.save}%</td>
                <td style={tdStyle}>{tier.alloc.invest}%</td>
                <td style={tdStyle}>{tier.alloc.enjoy}%</td>
                <td style={tdStyle}>{tier.alloc.keep}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════ Modificateurs ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Modificateurs contextuels</h2>
      <p style={{ color: COLORS.textSecondary, marginBottom: 16, fontSize: 14 }}>
        Après le calcul de base, des ajustements sont appliqués en fonction de la situation réelle.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
        {MODIFIERS.map((m) => (
          <div
            key={m.name}
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <div style={{ fontSize: 24, flexShrink: 0 }}>{m.icon}</div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.name}</div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6 }}>{m.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ══════════ Règles de filtrage ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Règles de filtrage</h2>
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 40,
        }}
      >
        <ul style={{ margin: 0, paddingLeft: 20, color: COLORS.textSecondary, lineHeight: 2 }}>
          <li>Les recommandations avec moins de <strong style={{ color: COLORS.text }}>5 %</strong> sont masquées</li>
          <li>Leurs pourcentages sont redistribués aux recommandations restantes</li>
          <li>Le total fait toujours exactement <strong style={{ color: COLORS.text }}>100 %</strong> du « À dépenser »</li>
          <li>Minimum <strong style={{ color: COLORS.text }}>2</strong> recommandations, maximum <strong style={{ color: COLORS.text }}>4</strong></li>
          <li>Les recommandations sont <strong style={{ color: COLORS.text }}>ignorables</strong> par mois (stockées en local)</li>
        </ul>
      </div>

      {/* ══════════ Exemple ══════════ */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Exemple concret</h2>
      <div
        style={{
          backgroundColor: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.8 }}>
          <p><strong style={{ color: COLORS.text }}>Situation :</strong></p>
          <ul style={{ margin: '4px 0 12px', paddingLeft: 20 }}>
            <li>Épargne : 8 000 € (seuil optimal = 10 000 €) → palier <span style={{ color: '#f59e0b', fontWeight: 600 }}>À renforcer</span></li>
            <li>À dépenser : 1 000 €</li>
            <li>Tendance variables : 95 % (normal)</li>
            <li>Ratio investissement : 5 % (faible → bonus investir +8 pp)</li>
          </ul>

          <p><strong style={{ color: COLORS.text }}>Allocation de base :</strong> 40 / 15 / 20 / 25</p>
          <p><strong style={{ color: COLORS.text }}>Après modificateur investissement :</strong> 32 / 23 / 20 / 25</p>
          <p><strong style={{ color: COLORS.text }}>Après normalisation :</strong> 32 / 23 / 20 / 25 = 100 %</p>

          <p style={{ marginTop: 12 }}><strong style={{ color: COLORS.text }}>Résultat :</strong></p>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            <li><span style={{ color: RECO_COLORS.save }}>🛡️ Épargner : 320 €</span></li>
            <li><span style={{ color: RECO_COLORS.invest }}>📈 Investir : 230 €</span></li>
            <li><span style={{ color: RECO_COLORS.enjoy }}>✨ Se faire plaisir : 200 €</span></li>
            <li><span style={{ color: RECO_COLORS.keep }}>⏳ Conserver : 250 €</span></li>
          </ul>
        </div>
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
