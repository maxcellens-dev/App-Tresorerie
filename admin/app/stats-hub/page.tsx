'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function StatsHubPage() {
  const [stats, setStats] = useState<{ totalEvents: number; uniqueUsers: number; lastDayEvents: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!url || !key) {
      setLoading(false);
      setError('Configurez les variables Supabase.');
      return;
    }
    const supabase = createClient(url, key);
    supabase
      .from('user_activity')
      .select('id, user_id, created_at')
      .then(({ data, error: e }) => {
        if (e) {
          setError(e.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as { id: string; user_id: string | null; created_at: string }[];
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const lastDay = rows.filter((r) => new Date(r.created_at) >= oneDayAgo);
        const uniqueUsers = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
        setStats({
          totalEvents: rows.length,
          uniqueUsers,
          lastDayEvents: lastDay.length,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;
  if (error) return <main style={{ padding: 24 }}>Erreur : {error}</main>;

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Stats Hub</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Métriques agrégées depuis user_activity (DAU = événements dernières 24h).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: 20, background: '#f5f5f5', borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Total événements</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.totalEvents ?? 0}</div>
        </div>
        <div style={{ padding: 20, background: '#f5f5f5', borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Utilisateurs uniques</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.uniqueUsers ?? 0}</div>
        </div>
        <div style={{ padding: 20, background: '#f5f5f5', borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Dernières 24h (DAU)</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.lastDayEvents ?? 0}</div>
        </div>
      </div>
      <p style={{ marginTop: 24, fontSize: 13, color: '#666' }}>
        Enregistrez des événements depuis l’app (ex. ouverture, saisie) dans user_activity pour alimenter ces stats.
      </p>
    </main>
  );
}
