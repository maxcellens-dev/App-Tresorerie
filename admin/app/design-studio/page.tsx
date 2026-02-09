'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const defaultThemeConfig = {
  primaryColor: '#34d399',
  secondaryColor: '#64748b',
  fontFamily: 'System',
  buttonRadius: 12,
};

export default function DesignStudioPage() {
  const [config, setConfig] = useState(defaultThemeConfig);
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
      .select('theme_config')
      .eq('id', 'default')
      .single()
      .then(({ data }) => {
        if (data?.theme_config) setConfig({ ...defaultThemeConfig, ...data.theme_config });
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
        .update({ theme_config: config, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      setMessage('theme_config enregistré.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Design Studio</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>theme_config (primaryColor, secondaryColor, fontFamily, buttonRadius)</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>
          Couleur primaire
          <input
            type="color"
            value={config.primaryColor}
            onChange={(e) => setConfig((c) => ({ ...c, primaryColor: e.target.value }))}
            style={{ marginLeft: 8, width: 40, height: 28 }}
          />
          <input
            type="text"
            value={config.primaryColor}
            onChange={(e) => setConfig((c) => ({ ...c, primaryColor: e.target.value }))}
            style={{ marginLeft: 8, width: 100, fontFamily: 'monospace' }}
          />
        </label>
        <label>
          Couleur secondaire
          <input
            type="color"
            value={config.secondaryColor}
            onChange={(e) => setConfig((c) => ({ ...c, secondaryColor: e.target.value }))}
            style={{ marginLeft: 8, width: 40, height: 28 }}
          />
          <input
            type="text"
            value={config.secondaryColor}
            onChange={(e) => setConfig((c) => ({ ...c, secondaryColor: e.target.value }))}
            style={{ marginLeft: 8, width: 100, fontFamily: 'monospace' }}
          />
        </label>
        <label>
          Rayon des boutons
          <input
            type="number"
            value={config.buttonRadius}
            onChange={(e) => setConfig((c) => ({ ...c, buttonRadius: Number(e.target.value) || 0 }))}
            style={{ marginLeft: 8, width: 60 }}
          />
        </label>
      </div>
      <div style={{ marginTop: 24 }}>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer theme_config'}
        </button>
        {message && <span style={{ marginLeft: 16, color: message.startsWith('Erreur') ? '#c00' : '#0a0' }}>{message}</span>}
      </div>
    </main>
  );
}
