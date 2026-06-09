/**
 * SocialAuthButtons — connexion/inscription via Google, Apple et Facebook (mises en avant).
 * Utilise supabase.auth.signInWithOAuth. Tant que les fournisseurs ne sont pas configurés
 * côté Supabase, un message « bientôt disponible » s'affiche au lieu d'échouer brutalement.
 */
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useBrandColors } from '../hooks/useBrandColors';

type Provider = 'google' | 'apple' | 'facebook';

const PROVIDERS: { id: Provider; label: string; icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string; border?: string }[] = [
  { id: 'google', label: 'Continuer avec Google', icon: 'logo-google', bg: '#ffffff', fg: '#1f1f1f', border: '#dadce0' },
  { id: 'apple', label: 'Continuer avec Apple', icon: 'logo-apple', bg: '#000000', fg: '#ffffff' },
  { id: 'facebook', label: 'Continuer avec Facebook', icon: 'logo-facebook', bg: '#1877F2', fg: '#ffffff' },
];

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}

export default function SocialAuthButtons({ mode }: { mode: 'login' | 'register' }) {
  const COLORS = useBrandColors();
  const styles = makeStyles(COLORS);

  async function go(provider: Provider) {
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    try {
      const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) throw error;
      // Sur web, Supabase redirige vers le fournisseur ; au retour, la session est créée.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible.';
      showAlert('Bientôt disponible', `La connexion ${provider.charAt(0).toUpperCase() + provider.slice(1)} n'est pas encore activée. ${msg}`);
    }
  }

  return (
    <View style={styles.wrap}>
      {PROVIDERS.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={[styles.btn, { backgroundColor: p.bg, borderColor: p.border ?? p.bg }]}
          onPress={() => go(p.id)}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Ionicons name={p.icon} size={20} color={p.fg} />
          <Text style={[styles.btnText, { color: p.fg }]}>{p.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { gap: 10 },
    btn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      borderRadius: 12, paddingVertical: 14, borderWidth: 1,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    btnText: { fontSize: 15, fontWeight: '700' },
  });
}
