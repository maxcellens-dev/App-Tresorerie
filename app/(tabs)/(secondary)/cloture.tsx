import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RootPortal } from '../../../lib/rootPortal';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useMonthlyClosure, monthLabel } from '../../../hooks/pilotage/useMonthlyClosure';

export default function ClotureScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { user } = useAuth();
  const { enabled, confirmedClosures, pendingMonths, closeMonths, reopenMonth, reopenableMonth } = useMonthlyClosure(user?.id);

  /* ── PLUS AUCUN `<Modal>` SUR CET ÉCRAN ─────────────────────────────────────────────────────
     Le voile résiduel après une réouverture venait du composant `Modal` lui-même : sur le web il
     démonte son contenu avant la fin du fondu, et sur Android il ouvre une FENÊTRE séparée. Passer
     de la confirmation à l'attente dans cette fenêtre-là revenait à la fermer et la rouvrir, et
     c'est ce cycle qui laissait un calque orphelin à l'écran. Deux essais successifs pour le régler
     par l'état ont échoué : c'était le mauvais outil.

     Les deux calques sont donc rendus par `RootPortal` — la même fenêtre que le reste de l'app,
     au-dessus de la navigation, sans aucune animation. Ils apparaissent au montage et disparaissent
     entièrement au démontage : il n'y a plus rien qui puisse survivre à leur fermeture.

     Un seul état gouverne les deux : on passe de `confirm` à `busy` sans jamais repasser par
     « rien », et l'attente se termine par une disparition — pas par une étape « terminé ». */
  type Dialog =
    | { kind: 'confirm'; title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }
    | { kind: 'busy'; label: string };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const askConfirm = (opts: Omit<Extract<Dialog, { kind: 'confirm' }>, 'kind'>) => setDialog({ kind: 'confirm', ...opts });
  const [error, setError] = useState<string | null>(null);

  const busy = dialog?.kind === 'busy';
  /* Rouvrir supprime les régularisations du mois PUIS recalcule le solde de chaque compte, un
     aller-retour serveur par compte : plusieurs secondes sur une connexion moyenne. Sans retour
     visible, on retape « Rouvrir » — sur une opération qui écrit en base. */
  const runReopen = (monthKey: string) => {
    setError(null);
    setDialog({ kind: 'busy', label: 'Réouverture en cours…' });
    reopenMonth.mutate(monthKey, {
      onSettled: () => setDialog(null),
      onError: (e: any) => setError(e?.message ?? "La réouverture n'a pas abouti. Réessaie."),
    });
  };

  /* Uniquement les mois CONFIRMÉS : un mois `estimated` (auto-marqué faute de réponse) n'est pas
     clôturé, il reste à clôturer. Cet écran lisait `closures` en entier — d'où le même mois affiché
     à la fois en « en attente » et en « clôturé ». Le filtre vit maintenant dans le hook, avec les
     trois autres écrans qui le faisaient déjà chacun de leur côté. */
  const closedSorted = [...confirmedClosures].sort((a, b) => b.month_key.localeCompare(a.month_key));
  const pendingDesc = [...pendingMonths].sort((a, b) => b.localeCompare(a)); // plus récent en haut

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right']}>
        {/* En-tête PARTAGÉ (ScreenHeader) : « ← Retour » sur sa ligne, puis le titre en dessous.
            Cette page les mettait côte à côte sur une seule ligne, avec ses propres tailles — seul
            écran secondaire à le faire, d'où l'impression de changer d'app en y arrivant. Recopier
            les valeurs du composant aurait recréé la même dérive plus tard. */}
        <ScreenHeader title="Clôture mensuelle" onBack={goBack} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {!enabled ? (
            <Text style={styles.subtitle}>La clôture mensuelle n'est pas activée.</Text>
          ) : (
            <>
              <Text style={styles.subtitle}>Rouvre une période pour pouvoir y saisir ou modifier des transactions, ou clôture un mois en attente.</Text>
              {!!error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Text style={styles.sectionTitle}>Mois en attente</Text>
              <View style={styles.card}>
                {pendingDesc.length === 0 ? (
                  <Text style={styles.empty}>Aucun mois en attente.</Text>
                ) : (
                  pendingDesc.map((mk) => (
                    <View key={mk} style={styles.row}>
                      <Ionicons name="hourglass-outline" size={18} color={COLORS.yellow} />
                      <Text style={styles.rowLabel}>{monthLabel(mk)}</Text>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => askConfirm({
                          title: 'Clôturer le mois',
                          message: `Clôturer ${monthLabel(mk)} ? Les transactions de cette période seront verrouillées.`,
                          confirmLabel: 'Clôturer',
                          confirmColor: COLORS.emerald,
                          // Même fenêtre du début à la fin : elle passe en attente, puis se ferme.
                          onConfirm: () => {
                            setError(null);
                            setDialog({ kind: 'busy', label: 'Clôture en cours…' });
                            closeMonths.mutate({ monthKeys: [mk], surplus: 0 }, {
                              onSettled: () => setDialog(null),
                              onError: (e: any) => setError(e?.message ?? "La clôture n'a pas abouti. Réessaie."),
                            });
                          },
                        })}
                      >
                        <Ionicons name="lock-closed-outline" size={14} color={COLORS.emerald} />
                        <Text style={[styles.actionText, { color: COLORS.emerald }]}>Clôturer</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.sectionTitle}>Mois clôturés</Text>
              <View style={styles.card}>
                {closedSorted.length === 0 ? (
                  <Text style={styles.empty}>Aucun mois clôturé.</Text>
                ) : (
                  /* On ne peut rouvrir QUE la dernière clôture : rouvrir un mois plus ancien
                     laisserait les régularisations des mois suivants — calculées par rapport au
                     solde qu'on vient d'annuler — dans un état faux. On dépile dans l'ordre. */
                  closedSorted.map((c) => {
                    const canReopen = c.month_key === reopenableMonth;
                    return (
                    <View key={c.month_key} style={styles.row}>
                      <Ionicons name="lock-closed" size={18} color={COLORS.textSecondary} />
                      <Text style={styles.rowLabel}>{monthLabel(c.month_key)}</Text>
                      {canReopen ? (
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => askConfirm({
                            title: 'Rouvrir le mois',
                            message: `Rouvrir ${monthLabel(c.month_key)} ?\n\nLes régularisations créées par cette clôture seront supprimées et tes soldes recalculés. Tes transactions, elles, ne bougent pas.`,
                            confirmLabel: 'Rouvrir',
                            confirmColor: COLORS.blue,
                            onConfirm: () => runReopen(c.month_key),
                          })}
                        >
                          <Ionicons name="lock-open-outline" size={14} color={COLORS.blue} />
                          <Text style={[styles.actionText, { color: COLORS.blue }]}>Rouvrir</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.lockedHint}>
                          Rouvre d’abord {reopenableMonth ? monthLabel(reopenableMonth) : 'le mois le plus récent'}
                        </Text>
                      )}
                    </View>
                    );
                  })
                )}
              </View>
              <Text style={styles.note}>Astuce : pour clôturer avec saisie de ton solde réel, utilise la bannière de clôture sur le Pilotage.</Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>


      {/* UN SEUL CALQUE, un seul état (cf. `Dialog` plus haut) : du choix à l'attente sans jamais
          se fermer entre les deux, puis une seule disparition à la fin. Aucune étape « terminé » —
          la disparition EST la confirmation. Rendu au sommet de l'arbre, dans la MÊME fenêtre :
          quand `dialog` repasse à null, l'arbre entier est démonté, il ne peut rien rester. */}
      {dialog && (
        <RootPortal>
          <View style={styles.overlay}>
            {/* Fermeture au clic à côté — jamais pendant une écriture en base. */}
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => { if (!busy) setDialog(null); }}
            />
            <View style={styles.box}>
              {dialog.kind === 'busy' ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator size="small" color={COLORS.blue} />
                  <Text style={styles.busyLabel}>{dialog.label}</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.confirmTitle}>{dialog.title}</Text>
                  <Text style={styles.confirmMessage}>{dialog.message}</Text>
                  <View style={styles.confirmBtns}>
                    <TouchableOpacity style={styles.confirmCancel} onPress={() => setDialog(null)}>
                      <Text style={styles.confirmCancelText}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.confirmOk, { borderColor: dialog.confirmColor, backgroundColor: dialog.confirmColor + '18' }]}
                      /* On NE ferme PAS avant d'agir : `onConfirm` pose lui-même l'état suivant
                         (attente), ce qui garde le calque affiché d'un bout à l'autre. */
                      onPress={() => dialog.onConfirm()}
                    >
                      <Text style={[styles.confirmOkText, { color: dialog.confirmColor }]}>{dialog.confirmLabel}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </RootPortal>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    // (l'en-tête vient de ScreenHeader : ni pageHeader, ni backBtn, ni title à redéfinir ici)
    subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 20, lineHeight: 20 },
    sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 16, marginBottom: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    rowLabel: { flex: 1, fontSize: 15, color: c.text, fontWeight: '600', textTransform: 'capitalize' },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder },
    actionText: { fontSize: 12, fontWeight: '700' },
    empty: { fontSize: 13, color: c.textSecondary, paddingVertical: 14, textAlign: 'center' },
    note: { fontSize: 12, color: c.textSecondary, lineHeight: 17, fontStyle: 'italic' },
    lockedHint: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', maxWidth: 170, textAlign: 'right' },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', borderRadius: 12, padding: 11, marginBottom: 16 },
    errorText: { flex: 1, fontSize: 12.5, color: c.danger, lineHeight: 17 },
    // Attente affichée DANS le calque de confirmation (jamais un second calque).
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    busyLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    box: { backgroundColor: c.cardSolid, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: c.cardBorder },
    confirmTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 10 },
    confirmMessage: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
    confirmBtns: { flexDirection: 'row', gap: 12 },
    confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    confirmCancelText: { color: c.textSecondary, fontWeight: '600', fontSize: 15 },
    confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    confirmOkText: { fontWeight: '700', fontSize: 15 },
  });
}
