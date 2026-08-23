import { useMemo, useState } from 'react';
/**
 * SocialAuthButtons — connexion/inscription via Google, Apple et Facebook.
 *
 * Web : supabase.auth.signInWithOAuth redirige la page (retour → session créée).
 * Natif : signInWithOAuth(skipBrowserRedirect) → on ouvre le navigateur d'auth
 *   (expo-web-browser) avec un redirect vers le scheme de l'app (relyka-app://auth-callback),
 *   puis on récupère la session depuis l'URL de retour (code PKCE ou tokens en fragment).
 *
 * ⚠️ Côté Supabase : l'URL `relyka-app://auth-callback` DOIT être ajoutée dans
 *    Authentication → URL Configuration → Redirect URLs. Sans ça, après Google, Supabase
 *    redirige vers son Site URL (page web) → le navigateur reste ouvert et ne revient
 *    jamais dans l'app (symptôme « bloqué sur Chrome »).
 */
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/platform/supabase';
import { useBrandColors } from '../../hooks/theme/useBrandColors';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { describeAuthError } from '../../lib/auth/authErrors';

// Permet à expo-web-browser de finaliser une session d'auth restée ouverte.
WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'apple' | 'facebook';

const PROVIDERS: { id: Provider; label: string; icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string; border?: string }[] = [
  { id: 'google', label: 'Continuer avec Google', icon: 'logo-google', bg: '#ffffff', fg: '#1f1f1f', border: '#dadce0' },
  // Connexion Apple masquée pour l'instant (non gérée).
  { id: 'facebook', label: 'Continuer avec Facebook', icon: 'logo-facebook', bg: '#1877F2', fg: '#ffffff' },
];

function showAlert(title: string, message: string) {
  Alert.alert(title, message);
}

/** Récupère une valeur dans une query/fragment string (parsing manuel — fiable en RN). */
function paramFrom(str: string, key: string): string | null {
  for (const part of str.split('&')) {
    const eq = part.indexOf('=');
    const k = eq >= 0 ? part.slice(0, eq) : part;
    if (decodeURIComponent(k) === key) return decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : '');
  }
  return null;
}

export default function SocialAuthButtons({ mode }: { mode: 'login' | 'register' }) {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  /* Un deuxième appui pendant l'ouverture du navigateur d'authentification lançait un SECOND
     `openAuthSessionAsync` : Android/iOS refusent (« Another WebBrowser is already being
     presented ») et ce refus technique, en anglais, remontait à l'utilisateur comme un échec de
     connexion Google. Un seul départ à la fois, et l'attente est visible. */
  const lock = useSubmitLock();
  const [busy, setBusy] = useState<Provider | null>(null);

  async function go(provider: Provider) {
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    if (!lock.acquire()) return;
    setBusy(provider);
    // Web : après un départ RÉUSSI, la page est remplacée par celle du fournisseur — on garde le
    // bouton occupé jusqu'au bout. En cas d'échec (réseau coupé), en revanche, il DOIT redevenir
    // cliquable : rien ne va se produire, et un bouton grisé à vie condamnerait la connexion.
    let leavingPage = false;
    try {
      // ── Web : redirection classique de la page ──
      if (Platform.OS === 'web') {
        const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
        const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
        if (error) throw error;
        leavingPage = true;
        return;
      }

      // ── Natif : navigateur d'auth + retour via le scheme de l'app ──
      // relyka-app://auth-callback (app.json > expo.scheme). L'ancien commentaire annonçait encore
      // `tresorerie://`, le schéma d'avant le renommage : de quoi chercher longtemps la mauvaise URL
      // dans la console Supabase le jour où le retour de Google ne revient pas dans l'app.
      const redirectTo = Linking.createURL('auth-callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("URL d'authentification indisponible.");

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return; // annulé / fermé par l'utilisateur

      const url = result.url;
      // 1) Flux PKCE : ?code=...
      const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
      const code = paramFrom(query, 'code');
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) throw exErr;
        return; // onAuthStateChange → redirection par le guard
      }
      // 2) Flux implicite : #access_token=...&refresh_token=...
      const hash = url.includes('#') ? url.split('#')[1] : '';
      const access_token = paramFrom(hash, 'access_token');
      const refresh_token = paramFrom(hash, 'refresh_token');
      if (access_token && refresh_token) {
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
        if (setErr) throw setErr;
        return;
      }
      // Erreur renvoyée par le fournisseur, le cas échéant.
      const errDesc = paramFrom(query, 'error_description') || paramFrom(hash, 'error_description');
      throw new Error(errDesc || "Réponse d'authentification invalide.");
    } catch (e: unknown) {
      // Messages traduits, comme sur la connexion par e-mail (lib/auth/authErrors) : une coupure
      // réseau sortait ici en anglais (« Failed to fetch »).
      const msg = describeAuthError(e).message;
      showAlert('Connexion impossible', `${provider.charAt(0).toUpperCase() + provider.slice(1)} : ${msg}`);
    } finally {
      if (!leavingPage) { setBusy(null); lock.release(); }
    }
  }

  return (
    <View style={styles.wrap}>
      {PROVIDERS.map((p) => {
        const isBusy = busy === p.id;
        const disabled = busy !== null;
        return (
          <TouchableOpacity
            key={p.id}
            style={[styles.btn, { backgroundColor: p.bg, borderColor: p.border ?? p.bg }, disabled && !isBusy && styles.btnDimmed]}
            onPress={() => go(p.id)}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: isBusy }}
          >
            {isBusy
              ? <ActivityIndicator size="small" color={p.fg} />
              : <Ionicons name={p.icon} size={20} color={p.fg} />}
            <Text style={[styles.btnText, { color: p.fg }]}>{isBusy ? 'Connexion…' : p.label}</Text>
          </TouchableOpacity>
        );
      })}
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
    btnDimmed: { opacity: 0.5 },
    btnText: { fontSize: 15, fontWeight: '700' },
  });
}
