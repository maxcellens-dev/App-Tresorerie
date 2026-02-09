'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const THEME_COLOR_KEYS = [
  'primary',
  'secondary',
  'background',
  'surface',
  'text',
  'textMuted',
  'success',
  'warning',
  'danger',
] as const;

type ThemeColors = Record<(typeof THEME_COLOR_KEYS)[number], string>;

const defaultTheme: { colors: ThemeColors; fonts: { heading: string; body: string } } = {
  colors: {
    primary: '#2563eb',
    secondary: '#64748b',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textMuted: '#64748b',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
  },
  fonts: { heading: 'System', body: 'System' },
};

const defaultTexts = {
  appName: 'MyTreasury',
  tagline: 'Votre santé financière en un coup d\'œil',
  seo: {} as Record<string, string>,
};

export default function StyleEditorPage() {
  const [theme, setTheme] = useState(defaultTheme);
  const [texts, setTexts] = useState(defaultTexts);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    setSupabaseUrl(url);
    setSupabaseKey(key);
    if (url && key) {
      loadConfig(url, key);
    } else {
      setLoading(false);
    }
  }, []);

  async function loadConfig(url: string, key: string) {
    try {
      const supabase = createClient(url, key);
      const { data, error } = await supabase.from('app_config').select('theme, texts').eq('id', 'default').single();
      if (!error && data) {
        setTheme({
          colors: { ...defaultTheme.colors, ...(data.theme?.colors ?? {}) },
          fonts: { ...defaultTheme.fonts, ...(data.theme?.fonts ?? {}) },
        });
        setTexts({ ...defaultTexts, ...(data.texts ?? {}), seo: { ...defaultTexts.seo, ...(data.texts?.seo ?? {}) } });
      }
    } catch (_) {
      setMessage('Erreur chargement config');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!supabaseUrl || !supabaseKey) {
      setMessage('Configurez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase
        .from('app_config')
        .update({ theme, texts, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      setMessage('Config enregistrée. Les apps recevront la mise à jour au prochain sync.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  }

  function updateColor(key: (typeof THEME_COLOR_KEYS)[number], value: string) {
    setTheme((t) => ({ ...t, colors: { ...t.colors, [key]: value } }));
  }

  if (loading) {
    return <main style={{ padding: 24 }}>Chargement…</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Style Editor</h1>
      <p>Modifiez le thème et les textes SEO. Sauvegardez pour mettre à jour la table <code>app_config</code>.</p>

      <section style={{ marginTop: 24 }}>
        <h2>Couleurs (Hex)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {THEME_COLOR_KEYS.map((key) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={theme.colors[key]}
                onChange={(e) => updateColor(key, e.target.value)}
                style={{ width: 40, height: 32, padding: 0, border: '1px solid #ccc' }}
              />
              <span style={{ flex: 1 }}>{key}</span>
              <input
                type="text"
                value={theme.colors[key]}
                onChange={(e) => updateColor(key, e.target.value)}
                style={{ width: 100, fontFamily: 'monospace' }}
              />
            </label>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Textes & SEO</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Nom de l’app
            <input
              type="text"
              value={texts.appName}
              onChange={(e) => setTexts((t) => ({ ...t, appName: e.target.value }))}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Tagline
            <input
              type="text"
              value={texts.tagline}
              onChange={(e) => setTexts((t) => ({ ...t, tagline: e.target.value }))}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </label>
          <p style={{ color: '#666' }}>Textes SEO (clé → valeur) : à étendre selon besoin.</p>
        </div>
      </section>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '10px 20px', cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer dans Supabase'}
        </button>
        {message && <span style={{ color: message.startsWith('Erreur') ? '#c00' : '#0a0' }}>{message}</span>}
      </div>
    </main>
  );
}
