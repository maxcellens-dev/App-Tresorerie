import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function AssistanceScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Assistance</Text>
          <Text style={styles.subtitle}>
            Notre équipe est disponible pour vous aider avec toute question concernant Trésorerie.
          </Text>

          <View style={styles.card}>
            <Ionicons name="mail-outline" size={28} color={COLORS.emerald} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Contactez-nous par email</Text>
            <Text style={styles.cardText}>
              Pour toute question technique, demande de fonctionnalité ou signalement de bug, envoyez-nous un email détaillé.
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => Linking.openURL('mailto:support@tresorerie.app?subject=Demande%20d%27assistance')}
            >
              <Text style={styles.btnText}>support@tresorerie.app</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Ionicons name="help-circle-outline" size={28} color="#60a5fa" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>FAQ</Text>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Comment ajouter un compte ?</Text>
              <Text style={styles.faqA}>Allez dans l'onglet "Comptes" puis appuyez sur le bouton "Compte" pour créer un nouveau compte bancaire.</Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Comment fonctionne le "À dépenser en sécurité" ?</Text>
              <Text style={styles.faqA}>Ce montant prend votre solde courant et déduit les dépenses à venir (fixes, variables prévues, allocations projets et objectifs) ainsi qu'une marge de sécurité configurable dans les Paramètres.</Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Les transactions récurrentes sont-elles automatiques ?</Text>
              <Text style={styles.faqA}>Oui, une fois créée, une transaction récurrente se projette automatiquement sur les mois futurs dans votre plan de trésorerie.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Ionicons name="time-outline" size={28} color="#f59e0b" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Horaires de support</Text>
            <Text style={styles.cardText}>
              Lundi - Vendredi : 9h00 - 18h00 (CET){'\n'}
              Temps de réponse moyen : 24h
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 20, marginBottom: 16, gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' },
  cardText: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },
  btn: {
    backgroundColor: COLORS.emerald, paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12,
  },
  btnText: { fontSize: 14, fontWeight: '700', color: COLORS.bg },
  faqItem: { marginTop: 12, gap: 4 },
  faqQ: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  faqA: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
});
