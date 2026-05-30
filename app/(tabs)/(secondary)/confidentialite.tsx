import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';


export default function PrivacyScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Politique de confidentialité</Text>
          </View>
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="1. Données collectées">
            Trésorerie collecte uniquement les données nécessaires au fonctionnement de l'application :{'\n\n'}
            • <B>Identité</B> : adresse e-mail, prénom (optionnel){'\n'}
            • <B>Données financières</B> : comptes, transactions, catégories, projets et objectifs que vous saisissez{'\n'}
            • <B>Préférences</B> : paramètres de l'application, avatar{'\n\n'}
            Aucune donnée bancaire réelle (IBAN, identifiants bancaires) n'est collectée.
          </Section>

          <Section title="2. Utilisation des données">
            Vos données sont utilisées exclusivement pour :{'\n\n'}
            • Vous fournir les fonctionnalités de gestion de trésorerie{'\n'}
            • Calculer vos indicateurs financiers (pilotage, plan de trésorerie){'\n'}
            • Synchroniser vos données entre vos appareils{'\n\n'}
            Nous ne vendons jamais vos données à des tiers.
          </Section>

          <Section title="3. Stockage et sécurité">
            Vos données sont hébergées sur des serveurs sécurisés via Supabase (hébergement AWS, région EU). Les communications sont chiffrées en transit (TLS) et au repos. L'authentification utilise des jetons sécurisés (JWT).
          </Section>

          <Section title="4. Droits de l'utilisateur">
            Conformément au RGPD, vous disposez des droits suivants :{'\n\n'}
            • <B>Accès</B> : consulter toutes vos données depuis l'application{'\n'}
            • <B>Rectification</B> : modifier vos informations à tout moment{'\n'}
            • <B>Suppression</B> : supprimer votre compte et toutes les données associées{'\n'}
            • <B>Portabilité</B> : exporter vos données au format standard{'\n\n'}
            Contact : privacy@tresorerie.app
          </Section>

          <Section title="5. Cookies et trackers">
            Trésorerie n'utilise aucun cookie publicitaire ni tracker tiers. Seuls des cookies techniques essentiels au fonctionnement sont utilisés.
          </Section>

          <Section title="6. Modifications">
            Cette politique peut être mise à jour. Vous serez informé(e) de tout changement significatif via une notification dans l'application.
          </Section>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function B({ children }: { children: React.ReactNode }) {
  const COLORS = useAppColors();
  return <Text style={{ fontWeight: '700', color: COLORS.text }}>{children}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { padding: 4, marginRight: 12 },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 6 },
  updated: { fontSize: 12, color: c.textSecondary, marginBottom: 24 },
  card: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 20, marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.emerald, marginBottom: 10 },
  sectionBody: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
});
}
