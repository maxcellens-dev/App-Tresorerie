/**
 * LegalScreen — contenu des mentions légales.
 * Rendu par la route publique /legal (accessible sans connexion).
 * Retour intelligent : revient en arrière s'il y a un historique, sinon vers l'accueil.
 */
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenGradient from './ScreenGradient';
import HeaderWithProfile from './HeaderWithProfile';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';

export default function LegalScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <HeaderWithProfile title="Mentions légales" showBack onBack={goBack} hideProfile={!user} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.contentWrap}>
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="Éditeur de l'application">
            Relyka{'\n'}
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
            L'ensemble des contenus de l'application Relyka (textes, graphismes, logiciels, images, icônes) est protégé par les lois relatives à la propriété intellectuelle.{'\n\n'}
            Toute reproduction, représentation ou diffusion, en tout ou partie, du contenu de cette application est interdite sans autorisation préalable.
          </Section>

          <Section title="Responsabilité">
            Relyka est un outil d'aide à la gestion financière personnelle. Les informations et calculs fournis ne constituent pas des conseils financiers professionnels.{'\n\n'}
            L'éditeur ne saurait être tenu responsable des décisions financières prises sur la base des données affichées dans l'application.{'\n\n'}
            L'exactitude des données dépend des informations saisies par l'utilisateur.
          </Section>

          <Section title="Conditions d'utilisation">
            En utilisant Relyka, vous acceptez les présentes conditions :{'\n\n'}
            • L'application est destinée à un usage personnel uniquement{'\n'}
            • Vous êtes responsable de la confidentialité de vos identifiants{'\n'}
            • Toute utilisation abusive peut entraîner la suspension du compte{'\n'}
            • Le service peut être modifié ou interrompu à tout moment
          </Section>

          <Section title="Droit applicable">
            Les présentes mentions légales sont régies par le droit français. Tout litige sera soumis aux tribunaux compétents.
          </Section>

          <View style={{ height: 40 }} />
          </View>
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
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  contentWrap: { width: '100%', maxWidth: 860, alignSelf: 'center' },
  updated: { fontSize: 12, color: c.textSecondary, marginBottom: 24 },
  card: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 20, marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.emerald, marginBottom: 10 },
  sectionBody: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
});
}
