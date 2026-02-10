export const metadata = { title: 'Trésorerie Admin' };
import Link from 'next/link';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#020617',
          color: '#ffffff',
        }}
      >
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            backgroundColor: '#0f172a',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              maxWidth: 960,
              margin: '0 auto',
              padding: '12px 16px',
            }}
          >
            <span style={{ fontWeight: 700 }}>Trésorerie Admin</span>
            <nav style={{ display: 'flex', gap: 16 }}>
              <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                Accueil
              </Link>
              <Link href="/style-editor" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                Style
              </Link>
              <Link href="/design-studio" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                Design
              </Link>
              <Link href="/seo-center" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                SEO
              </Link>
              <Link href="/stats-hub" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                Stats
              </Link>
            </nav>
          </div>
        </header>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>{children}</div>
      </body>
    </html>
  );
}
