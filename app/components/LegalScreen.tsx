/**
 * LegalScreen — contenu des mentions légales.
 * Rendu par la route publique /legal (accessible sans connexion).
 * Retour intelligent : revient en arrière s'il y a un historique, sinon vers l'accueil.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import LegalLayout from './LegalLayout';
import { useAppColors } from '../hooks/useAppColors';
import { useLegalContent } from '../hooks/useLegalContent';

export default function LegalScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const override = useLegalContent().data?.legal;
  // Contenu personnalisé en admin (§P9) → remplace le contenu par défaut.
  if (override) {
    return (
      <LegalLayout title="Mentions légales">
        <View style={styles.card}><Text style={styles.sectionBody}>{override}</Text></View>
      </LegalLayout>
    );
  }
  return (
    <LegalLayout title="Mentions légales">
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="Éditeur de l'application">
            Relyka{'\n'}
            Application de gestion de trésorerie personnelle{'\n\n'}
            Contact : relyka.dev@gmail.com
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

          <Section title="Suppression de votre compte et de vos données">
            Éditeur / développeur : <B>Relyka</B> (figurant sur la fiche Google Play).{'\n\n'}
            <B>Comment demander la suppression de votre compte :</B>{'\n'}
            1. Connectez-vous à l'application Relyka.{'\n'}
            2. Ouvrez votre Profil (icône en haut à droite).{'\n'}
            3. Appuyez sur « Supprimer mon compte », puis confirmez.{'\n\n'}
            Vous pouvez aussi en faire la demande par e-mail à relyka.dev@gmail.com (objet : « Suppression de compte »).{'\n\n'}
            <B>Données supprimées :</B> votre compte et l'ensemble des données associées (comptes financiers, transactions, catégories, projets, objectifs, préférences, avatar) sont définitivement et immédiatement supprimés.{'\n\n'}
            <B>Données conservées :</B> aucune donnée personnelle n'est conservée après la suppression. Les sauvegardes techniques chiffrées sont purgées sous 30 jours. Le cas échéant, seules les données strictement exigées par la loi (ex. obligations comptables) peuvent être conservées le temps légal requis.
          </Section>

          {/* Lien direct vers la suppression (depuis le profil) */}
          <TouchableOpacity style={styles.deleteLink} activeOpacity={0.8} onPress={() => router.push('/(tabs)/profile' as any)}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={styles.deleteLinkText}>Aller à mon profil pour supprimer mon compte</Text>
            <Ionicons name="chevron-forward" size={15} color={COLORS.danger} />
          </TouchableOpacity>

          <Section title="Droit applicable">
            Les présentes mentions légales sont régies par le droit français. Tout litige sera soumis aux tribunaux compétents.
          </Section>

    </LegalLayout>
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
  deleteLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12,
  },
  deleteLinkText: { fontSize: 13, fontWeight: '700', color: c.danger },
});
}
