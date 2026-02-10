import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function LegalScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Mentions légales</Text>
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="Éditeur de l'application">
            Trésorerie{'\n'}
            Application de gestion de trésorerie personnelle{'\n\n'}
            Contact : contact@tresorerie.app
          </Section>

          <Section title="Hébergement">
            L'application et ses données sont hébergées par :{'\n\n'}
            <B>Supabase Inc.</B>{'\n'}
            970 Toa Payoh North, #07-04{'\n'}
            Singapour 318992{'\n\n'}
            Infrastructure cloud : Amazon Web Services (AWS){'\n'}
            Région : Union Européenne (eu-west)
          </Section>

          <Section title="Propriété intellectuelle">
            L'ensemble des contenus de l'application Trésorerie (textes, graphismes, logiciels, images, icônes) est protégé par les lois relatives à la propriété intellectuelle.{'\n\n'}
            Toute reproduction, représentation ou diffusion, en tout ou partie, du contenu de cette application est interdite sans autorisation préalable.
          </Section>

          <Section title="Responsabilité">
            Trésorerie est un outil d'aide à la gestion financière personnelle. Les informations et calculs fournis ne constituent pas des conseils financiers professionnels.{'\n\n'}
            L'éditeur ne saurait être tenu responsable des décisions financières prises sur la base des données affichées dans l'application.{'\n\n'}
            L'exactitude des données dépend des informations saisies par l'utilisateur.
          </Section>

          <Section title="Conditions d'utilisation">
            En utilisant Trésorerie, vous acceptez les présentes conditions :{'\n\n'}
            • L'application est destinée à un usage personnel uniquement{'\n'}
            • Vous êtes responsable de la confidentialité de vos identifiants{'\n'}
            • Toute utilisation abusive peut entraîner la suspension du compte{'\n'}
            • Le service peut être modifié ou interrompu à tout moment
          </Section>

          <Section title="Droit applicable">
            Les présentes mentions légales sont régies par le droit français. Tout litige sera soumis aux tribunaux compétents.
          </Section>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontWeight: '700', color: '#ffffff' }}>{children}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  updated: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 24 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 20, marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.emerald, marginBottom: 10 },
  sectionBody: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
});
