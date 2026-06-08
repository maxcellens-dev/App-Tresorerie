import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';


export default function LegalScreen() {
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
            <Text style={styles.title}>Mentions légales</Text>
          </View>
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="Éditeur de l'application">
            Reliquat{'\n'}
            Application de gestion de trésorerie personnelle{'\n\n'}
            Contact : maxence.vi@gmail.com
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
            L'ensemble des contenus de l'application Reliquat (textes, graphismes, logiciels, images, icônes) est protégé par les lois relatives à la propriété intellectuelle.{'\n\n'}
            Toute reproduction, représentation ou diffusion, en tout ou partie, du contenu de cette application est interdite sans autorisation préalable.
          </Section>

          <Section title="Responsabilité">
            Reliquat est un outil d'aide à la gestion financière personnelle. Les informations et calculs fournis ne constituent pas des conseils financiers professionnels.{'\n\n'}
            L'éditeur ne saurait être tenu responsable des décisions financières prises sur la base des données affichées dans l'application.{'\n\n'}
            L'exactitude des données dépend des informations saisies par l'utilisateur.
          </Section>

          <Section title="Conditions d'utilisation">
            En utilisant Reliquat, vous acceptez les présentes conditions :{'\n\n'}
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
