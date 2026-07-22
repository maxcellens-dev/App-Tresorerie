/**
 * Frontière d'erreur RACINE : rattrape les exceptions de rendu React (qui, sinon, laissent un écran
 * blanc), les REMONTE au Centre de sécurité (reportError), et propose un écran de repli sobre avec
 * un bouton « Réessayer » (remonte le composant). Enveloppe toute l'app dans le root layout.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { reportError } from '../lib/errorReporting';

interface State { hasError: boolean; message: string }

export default class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message ?? 'Une erreur est survenue.' };
  }

  componentDidCatch(error: any, info: any) {
    reportError('fatal', error?.message ?? String(error), error?.stack ?? info?.componentStack ?? null, {
      componentStack: info?.componentStack ?? null,
    });
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.emoji}>😕</Text>
        <Text style={styles.title}>Oups, un souci est survenu</Text>
        <Text style={styles.sub}>
          On a été prévenus automatiquement. Tu peux réessayer — si ça persiste, redémarre l’app.
        </Text>
        <Pressable style={styles.btn} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.btnTxt}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }
}

// Palette neutre indépendante du thème (l'erreur peut survenir avant le montage du ThemeProvider).
const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#0D2E2A' },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#F4EFE6', textAlign: 'center', marginBottom: 10 },
  sub: { fontSize: 14, color: '#C7D2CE', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  btn: { backgroundColor: '#1FA97E', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  btnTxt: { fontSize: 15, fontWeight: '700', color: '#062019' },
});
