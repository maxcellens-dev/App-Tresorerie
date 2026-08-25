/**
 * Galerie des BANDEAUX — rendus avec les vrais composants de production, états forcés, rien d'écrit.
 *
 * Elle vivait dans un écran séparé (« Aperçu bandeaux ») qui montrait aussi la carte Relyka aux
 * différents niveaux de confiance — c'est-à-dire la même chose que le simulateur de fiabilité, en
 * moins souple. Les deux pages sont réunies sous « Fiabilité & confiance » : ici les bandeaux et les
 * formulations, dans l'onglet Simulateur tout ce qui touche au Relyka lui-même.
 *
 * Le flux COMPLET de clôture (modale, régularisations, bilan) écrit de vraies transactions : il se
 * teste sur un compte de test, pas ici.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { getCurrentAction, type AppStateInputs } from '../../lib/engagement/appStateEngine';
import { unverifiedSincePhrase, verifiedAgoPhrase } from '../../lib/finance/confidenceEngine';
import { ActionBannerCard } from '../onboarding/NextActionBanner';
import { ClosureBannerCard } from '../closure/MonthlyClosure';

function ymAdd(n: number): string {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

const noop = () => {};

export default function BannersGallery() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  /* ⚠️ AUCUNE variante ne parle du SOLDE : « Renseigne ton solde » et « Vérifie ton solde » ont été
     retirés du moteur d'état. La carte Relyka porte déjà cette information, à l'endroit exact où le
     chiffre se lit — et vérifier son solde en fin de mois, ou plus tard, reste un choix. */
  const base: AppStateInputs = {
    hasIncome: true, hasFixed: true,
    pendingClosureMonth: null, sharedModePrompt: null,
    jointLow: null, closureEnabled: true,
  };
  const variants: { label: string; inputs: AppStateInputs }[] = [
    { label: 'Réglage manquant — revenu', inputs: { ...base, hasIncome: false } },
    { label: 'Réglage manquant — charges fixes', inputs: { ...base, hasFixed: false } },
    { label: 'Compte partagé à qualifier', inputs: { ...base, sharedModePrompt: { accountId: 'demo', name: 'Compte commun' } } },
    { label: 'Proposition verrouillage (une seule fois)', inputs: { ...base, offerAppLock: true } },
    { label: 'Clôture en attente', inputs: { ...base, pendingClosureMonth: ymAdd(-1) } },
    { label: 'Compte commun bientôt à découvert', inputs: { ...base, jointLow: { accountId: 'demo', name: 'Compte commun' } } },
  ];

  return (
    <View>
      <Text style={styles.p}>
        Rendu de production, états forcés, données d'exemple : rien n'est écrit (fermer ou appuyer
        reste sans effet).
      </Text>

      <Text style={styles.section}>Bandeau « prochain geste » (Pilotage)</Text>
      <Text style={styles.p}>
        Une seule action à la fois, la plus prioritaire. Aucune ne réclame le solde : c'est la carte
        Relyka qui le signale, là où le chiffre se lit.
      </Text>
      {variants.map((v) => (
        <View key={v.label} style={styles.item}>
          <Text style={styles.itemLabel}>{v.label}</Text>
          {(() => {
            const a = getCurrentAction(v.inputs);
            return a ? <ActionBannerCard action={a} onDismiss={noop} /> : null;
          })()}
        </View>
      ))}

      <Text style={styles.section}>Bannière de clôture mensuelle (Pilotage)</Text>
      <View style={styles.item}>
        <Text style={styles.itemLabel}>1 mois en attente</Text>
        <ClosureBannerCard pendingMonths={[ymAdd(-1)]} />
      </View>
      <View style={styles.item}>
        <Text style={styles.itemLabel}>Plusieurs mois en attente</Text>
        <ClosureBannerCard pendingMonths={[ymAdd(-3), ymAdd(-2), ymAdd(-1)]} />
      </View>

      <Text style={styles.section}>Formulations d'ancienneté (jamais de compteur précis)</Text>
      <Text style={styles.p}>
        Un compte neuf jamais vérifié démarre au plafond d'ancienneté : « 21 j » n'aurait aucun sens.
        On emploie donc des formulations vagues.
      </Text>
      <View style={styles.phraseCard}>
        {[2, 8, 20, 60].map((d) => (
          <View key={d} style={styles.phraseRow}>
            <Text style={styles.phraseDays}>{d} j</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.phraseTxt}>Solde non vérifié <Text style={styles.phraseStrong}>{unverifiedSincePhrase(d)}</Text></Text>
              <Text style={styles.phraseTxt}>Vérifié <Text style={styles.phraseStrong}>{verifiedAgoPhrase(d)}</Text></Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
    section: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 8 },
    item: { marginBottom: 16 },
    itemLabel: { fontSize: 12.5, fontWeight: '800', color: c.emerald, marginBottom: 6 },
    phraseCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, gap: 10, marginTop: 8 },
    phraseRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    phraseDays: { width: 40, fontSize: 13, fontWeight: '800', color: c.text },
    phraseTxt: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    phraseStrong: { color: c.text, fontWeight: '700' },
  });
}
