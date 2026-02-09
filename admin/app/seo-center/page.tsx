'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const defaultSeo = {
  landingTitle: 'MyTreasury',
  landingDescription: 'Gérez votre trésorerie en toute sérénité.',
  metaTags: {} as Record<string, string>,
};

export default function SeoCenterPage() {
  const [config, setConfig] = useState(defaultSeo);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!url || !key) {
      setLoading(false);
      return;
    }
    const supabase = createClient(url, key);
    supabase
      .from('app_config')
      .select('seo_config')
      .eq('id', 'default')
      .single()
      .then(({ data }) => {
        if (data?.seo_config) setConfig({ ...defaultSeo, ...data.seo_config });
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!url || !key) {
      setMessage('Configurez les variables Supabase.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const supabase = createClient(url, key);
      const { error } = await supabase
        .from('app_config')
        .update({ seo_config: config, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      setMessage('seo_config enregistré.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>SEO Center</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>seo_config (landingTitle, landingDescription, metaTags)</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>
          Titre landing
          <input
            type="text"
            value={config.landingTitle}
            onChange={(e) => setConfig((c) => ({ ...c, landingTitle: e.target.value }))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Description landing
          <textarea
            value={config.landingDescription}
            onChange={(e) => setConfig((c) => ({ ...c, landingDescription: e.target.value }))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            rows={3}
          />
        </label>
      </div>
      <div style={{ marginTop: 24 }}>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer seo_config'}
        </button>
        {message && <span style={{ marginLeft: 16, color: message.startsWith('Erreur') ? '#c00' : '#0a0' }}>{message}</span>}
      </div>
    </main>
  );
}
