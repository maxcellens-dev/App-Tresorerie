import Link from 'next/link';

const COLORS = {
  card: '#0f172a',
  cardBorder: '#1e293b',
  textSecondary: '#94a3b8',
};

export default function AdminHome() {
  const items = [
    { href: '/recommendations', title: 'Recommandations', desc: 'Moteur intelligent et paliers' },
    { href: '/safe-to-spend', title: 'Formule À dépenser', desc: 'Explication du calcul détaillé' },
    { href: '/style-editor', title: 'Style Editor', desc: 'Thème et textes SEO' },
    { href: '/design-studio', title: 'Design Studio', desc: 'Couleurs et boutons' },
    { href: '/seo-center', title: 'SEO Center', desc: 'Landing et meta' },
    { href: '/stats-hub', title: 'Stats Hub', desc: 'Métriques et activité' },
  ];

  return (
    <main>
      <h1 style={{ marginBottom: 8 }}>Panneau Admin</h1>
      <p style={{ color: COLORS.textSecondary, marginBottom: 24 }}>
        Configuration dynamique et reporting. Les changements sont lus par l’app en mode Offline-First.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            style={{
              display: 'block',
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 12,
              padding: 16,
              textDecoration: 'none',
              color: '#ffffff',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{i.title}</div>
            <div style={{ color: COLORS.textSecondary }}>{i.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
