import { useMemo } from 'react';
/**
 * PrivacyScreen — contenu de la politique de confidentialité.
 * Rendu par la route publique /confidentialite (accessible sans connexion).
 * Retour intelligent : revient en arrière s'il y a un historique, sinon vers l'accueil.
 */
import { View, Text, StyleSheet } from 'react-native';
import LegalLayout from './LegalLayout';
import { usePublicColors } from '../hooks/usePublicColors';
import EditableLegalContent from './EditableLegalContent';

// Texte par défaut pré-rempli quand un admin clique « Modifier » (§P9).
const DEFAULT_PRIVACY_TEXT = `Politique de confidentialité — dernière mise à jour : juin 2025.

1. Données collectées
Relyka collecte uniquement les données nécessaires au fonctionnement : identité (e-mail, prénom optionnel), données financières que vous saisissez (comptes, transactions, catégories, projets, objectifs), préférences (paramètres, avatar). Aucune donnée bancaire réelle (IBAN, identifiants bancaires) n'est collectée.

2. Utilisation des données
Vos données servent exclusivement à : fournir la gestion de trésorerie, calculer vos indicateurs, synchroniser vos appareils. Nous ne vendons jamais vos données à des tiers.

3. Stockage et sécurité
Données hébergées via Supabase (AWS, région EU). Communications chiffrées (TLS) et au repos. Authentification par jetons sécurisés (JWT).

4. Droits de l'utilisateur (RGPD)
Accès, rectification, suppression (compte + données), portabilité. Contact : relyka.dev@gmail.com

5. Cookies et trackers
Aucun cookie publicitaire ni tracker tiers. Seuls des cookies techniques essentiels sont utilisés.

6. Modifications
Cette politique peut être mise à jour ; vous serez informé(e) de tout changement significatif via une notification dans l'application.`;

export default function PrivacyScreen() {
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return (
    <LegalLayout title="Politique de confidentialité">
      <EditableLegalContent which="privacy" seedText={DEFAULT_PRIVACY_TEXT}>
          <Text style={styles.updated}>Dernière mise à jour : juin 2025</Text>

          <Section title="1. Données collectées">
            Relyka collecte uniquement les données nécessaires au fonctionnement de l'application :{'\n\n'}
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
            Contact : relyka.dev@gmail.com
          </Section>

          <Section title="5. Cookies et trackers">
            Relyka n'utilise aucun cookie publicitaire ni tracker tiers. Seuls des cookies techniques essentiels au fonctionnement sont utilisés.
          </Section>

          <Section title="6. Modifications">
            Cette politique peut être mise à jour. Vous serez informé(e) de tout changement significatif via une notification dans l'application.
          </Section>
      </EditableLegalContent>
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
});
}
