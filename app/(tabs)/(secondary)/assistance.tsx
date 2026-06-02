import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';


export default function AssistanceScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
            <ScreenGradient /><SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => router.push('/(tabs)/(secondary)/parametres' as any)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Assistance</Text>
          </View>
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
              onPress={() => Linking.openURL('mailto:maxence.vi@gmail.com?subject=Demande%20d%27assistance')}
            >
              <Text style={styles.btnText}>maxence.vi@gmail.com</Text>
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { padding: 4, marginRight: 12 },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  card: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 20, marginBottom: 16, gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 8, textAlign: 'center' },
  cardText: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  btn: {
    backgroundColor: c.emerald, paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12,
  },
  btnText: { fontSize: 14, fontWeight: '700', color: c.bg },
  faqItem: { marginTop: 12, gap: 4 },
  faqQ: { fontSize: 14, fontWeight: '600', color: c.text },
  faqA: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
});
}
