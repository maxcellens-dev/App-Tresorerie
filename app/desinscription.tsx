/**
 * DÉSINSCRIPTION EN 1 CLIC — la cible du lien présent dans chaque e-mail non essentiel.
 *
 * Aucune connexion requise, et c'est volontaire : exiger un mot de passe pour arrêter de recevoir
 * des e-mails, c'est ne pas offrir de désinscription du tout. Le jeton (`email_unsub_token`) est
 * propre à chaque compte et ne donne accès à RIEN d'autre : la fonction serveur ne sait que
 * basculer `email_opt_in` à false.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../components/layout/ScreenGradient';
import { useBrandColors } from '../hooks/theme/useBrandColors';
import { supabase } from '../lib/platform/supabase';
import { signalAppReady } from '../lib/platform/splashGate';

export default function UnsubscribeScreen() {
  const COLORS = useBrandColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ t?: string }>();
  const token = Array.isArray(params.t) ? params.t[0] : params.t;
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => { signalAppReady(); }, []);

  useEffect(() => {
    (async () => {
      if (!token || !supabase) { setState('error'); return; }
      const { data, error } = await supabase.rpc('email_unsubscribe', { p_token: token });
      setState(!error && data === true ? 'done' : 'error');
    })();
  }, [token]);

  const s = makeStyles(COLORS);
  return (
    <View style={s.root}>
      <ScreenGradient />
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          {state === 'loading' && <ActivityIndicator color={COLORS.emerald} />}
          {state === 'done' && (
            <>
              <Ionicons name="checkmark-circle" size={44} color={COLORS.emerald} />
              <Text style={s.title}>C’est fait</Text>
              <Text style={s.text}>
                Tu ne recevras plus d’e-mails d’information de Relyka. Les messages de sécurité
                (mot de passe, changement d’adresse) continueront d’arriver — ils te servent à
                garder la main sur ton compte.
              </Text>
              <Text style={s.text}>Tu peux revenir sur ce choix à tout moment dans Paramètres → E-mails.</Text>
            </>
          )}
          {state === 'error' && (
            <>
              <Ionicons name="alert-circle-outline" size={44} color={COLORS.orange} />
              <Text style={s.title}>Lien invalide</Text>
              <Text style={s.text}>
                Ce lien de désinscription n’est plus valable. Tu peux couper les e-mails depuis
                l’application : Paramètres → E-mails.
              </Text>
            </>
          )}
          <TouchableOpacity style={s.btn} onPress={() => router.replace('/')}>
            <Text style={s.btnText}>Revenir à Relyka</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: {
      width: '100%', maxWidth: 460, alignItems: 'center', gap: 12,
      backgroundColor: c.card, borderRadius: 22, borderWidth: 1, borderColor: c.cardBorder, padding: 26,
    },
    title: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
    text: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },
    btn: { marginTop: 8, backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22 },
    btnText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
