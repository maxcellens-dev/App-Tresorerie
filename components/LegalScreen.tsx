import { useMemo } from 'react';
/**
 * LegalScreen — contenu des mentions légales.
 * Rendu par la route publique /legal (accessible sans connexion).
 * Retour intelligent : revient en arrière s'il y a un historique, sinon vers l'accueil.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import LegalLayout from './LegalLayout';
import { usePublicColors } from '../hooks/usePublicColors';
import EditableLegalContent from './EditableLegalContent';

// Texte par défaut pré-rempli quand un admin clique « Modifier » (§P9).
const DEFAULT_LEGAL_TEXT = `Mentions légales — dernière mise à jour : juin 2025.

Éditeur de l'application
Relyka — application de gestion de trésorerie personnelle. Contact : relyka.dev@gmail.com

Hébergement
Supabase Inc. (Singapour) — infrastructure AWS, région Union Européenne (eu-west).

Propriété intellectuelle
L'ensemble des contenus de Relyka est protégé. Toute reproduction, représentation ou diffusion sans autorisation est interdite.

Responsabilité
Relyka est un outil d'aide à la gestion financière personnelle. Les informations ne constituent pas des conseils financiers professionnels. L'exactitude des données dépend des informations saisies.

Conditions d'utilisation
Usage personnel uniquement. Vous êtes responsable de la confidentialité de vos identifiants. Le service peut être modifié ou interrompu à tout moment.

Suppression de votre compte et de vos données
Éditeur / développeur : Relyka (fiche Google Play). Pour supprimer votre compte : connectez-vous, ouvrez votre Profil, appuyez sur « Supprimer mon compte » et confirmez (ou demande par e-mail à relyka.dev@gmail.com). Données supprimées : compte et toutes les données associées, immédiatement. Données conservées : aucune donnée personnelle après suppression ; sauvegardes techniques purgées sous 30 jours.

Droit applicable
Droit français. Tout litige sera soumis aux tribunaux compétents.`;

export default function LegalScreen() {
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  return (
    <LegalLayout title="Mentions légales">
      <EditableLegalContent which="legal" seedText={DEFAULT_LEGAL_TEXT}>
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

          <Section title="Droit applicable">
            Les présentes mentions légales sont régies par le droit français. Tout litige sera soumis aux tribunaux compétents.
          </Section>
      </EditableLegalContent>

      {/* Lien direct vers la suppression — toujours visible (conformité Google) */}
      <TouchableOpacity style={styles.deleteLink} activeOpacity={0.8} onPress={() => router.push('/(tabs)/profile' as any)}>
        <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
        <Text style={styles.deleteLinkText}>Aller à mon profil pour supprimer mon compte</Text>
        <Ionicons name="chevron-forward" size={15} color={COLORS.danger} />
      </TouchableOpacity>
    </LegalLayout>
  );
}

function B({ children }: { children: React.ReactNode }) {
  const COLORS = usePublicColors();
  return <Text style={{ fontWeight: '700', color: COLORS.text }}>{children}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
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
