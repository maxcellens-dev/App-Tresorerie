import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './lib/supabase';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function RegisterScreen() {
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!email.trim() || !password) {
      Alert.alert('Champs requis', 'Renseignez email et mot de passe.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Mot de passe', 'Au moins 6 caractères.');
      return;
    }
    setLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        Alert.alert('Inscription', 'Vérifiez votre email pour confirmer le compte.');
        router.replace('/(tabs)/home');
      } else {
        Alert.alert('Inscription', 'Backend non configuré. Mode démo.');
        router.back();
      }
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Inscription impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Vos données seront synchronisées et sauvegardées.</Text>
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="vous@exemple.fr"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
            <Text style={styles.label}>Mot de passe (min. 6 caractères)</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleRegister}
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              <Text style={styles.btnLabel}>{loading ? 'Inscription…' : 'S’inscrire'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={() => router.back()}>
              <Text style={styles.linkText}>Déjà un compte ? Se connecter</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24 },
  keyboard: { flex: 1 },
  back: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 32 },
  form: {},
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 20,
  },
  btn: {
    backgroundColor: COLORS.emerald,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  link: { alignItems: 'center', marginTop: 20 },
  linkText: { fontSize: 14, color: COLORS.emerald, fontWeight: '500' },
});
