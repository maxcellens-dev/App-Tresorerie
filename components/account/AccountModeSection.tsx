// Mode d'usage d'un compte partagé/joint (périmètre quotidien), réglé par CHAQUE participant.
//   • Contribution : le compte sert aux charges communes ; vos virements vers lui = dépenses, ses
//     prélèvements internes sont invisibles pour votre budget.
//   • Suivi partagé : vous suivez le compte au quotidien ; ses dépenses comptent dans votre budget
//     à hauteur de votre part.
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { useAuth } from '../../contexts/AuthContext';
import { useMySharedMode, useSetSharedMode } from '../../hooks/data/useSharedMode';
import { useAllTransactions } from '../../hooks/data/useTransactions';
import { type SharedMode } from '../../lib/finance/perimeter';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { Account } from '../../types/database';

const OPTIONS: { mode: SharedMode; icon: string; title: string; desc: string }[] = [
  {
    mode: 'contribution', icon: 'home-outline',
    title: 'Pour les charges communes',
    desc: 'Loyer, crédits, copro… Tes virements vers ce compte comptent comme des dépenses ; ce qui s’y passe ensuite n’encombre pas ton budget.',
  },
  {
    mode: 'tracked', icon: 'cart-outline',
    title: 'Au quotidien',
    desc: 'Courses, sorties… Ses dépenses et recettes comptent dans ton budget, à hauteur de ta part.',
  },
];

export default function AccountModeSection({ account }: { account: Account }) {
  const COLORS = useAppColors();
  /* Consultation admin : ces écritures portent sur le compte visité et sur l'accès de tiers. */
  const roGuard = useReadOnlyGuard();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();

  // N'a de sens que pour un compte partagé/joint (au moins un autre participant).
  const isShared = !!account.is_joint || (!!(account as any).profile_id && (account as any).profile_id !== user?.id);
  const isReadOnly = (account as any)._role === 'read';

  const { data: mode, isLoading } = useMySharedMode(account.id, user?.id);
  const setMode = useSetSharedMode();
  const { data: allTx = [] } = useAllTransactions(user?.id);
  // Bascule en attente de confirmation (aperçu chiffré AVANT application).
  const [pendingMode, setPendingMode] = useState<SharedMode | null>(null);

  if (!isShared || isReadOnly) return null;

  const current = mode ?? null; // null = non répondu (interprété « Suivi partagé »)

  const choose = (m: SharedMode) => {
    if (m === current) { setPendingMode(null); return; }
    setPendingMode(m); // aperçu d'abord, application après confirmation
  };

  const confirmMode = () => {
    if (!pendingMode || roGuard.blocked()) return;
    setMode.mutate({ accountId: account.id, mode: pendingMode }, {
      onError: (e: any) => Alert.alert('Mode du compte', e?.message ?? 'Impossible de changer le mode.'),
      onSuccess: () => setPendingMode(null),
    });
  };

  // ── Aperçu d'impact (mois en cours) : montants réinterprétés, transactions JAMAIS modifiées. ──
  const monthPrefix = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; })();
  const inMonthOrMonthly = (t: any) => (t.date ?? '').startsWith(monthPrefix) || (t.is_recurring && t.recurrence_rule === 'monthly');
  // Mes virements VERS ce compte (jambe sortante côté perso) ce mois.
  const myTransfers = (allTx as any[])
    .filter((t) => t.linked_account_id === account.id && t.account_id !== account.id && Number(t.amount) < 0 && !t.is_draft && inMonthOrMonthly(t))
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  // Opérations internes du compte (dépenses hors virements) ce mois — quote-part au % du user.
  const pct = (account as any)._impact_pct ?? null;
  const internalRaw = (allTx as any[])
    .filter((t) => t.account_id === account.id && !t.linked_account_id && Number(t.amount) < 0 && !t.is_draft && inMonthOrMonthly(t))
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const internalPart = pct != null ? (internalRaw * pct) / 100 : internalRaw;
  const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Comment utilises-tu ce compte ?</Text>
      <Text style={styles.subtitle}>
        Cela n’affecte que la façon de compter dans TON budget — jamais le solde du compte ni tes transactions.
      </Text>

      {OPTIONS.map((opt) => {
        // Sélection VISUELLE : reflète le choix en attente (aperçu) dès le clic, sinon le mode
        // enregistré. Sans ça, tapoter un bouton ne le surlignait qu'après validation.
        const active = pendingMode ? pendingMode === opt.mode : current === opt.mode;
        return (
          <TouchableOpacity
            key={opt.mode}
            style={[styles.card, active && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '12' }]}
            activeOpacity={0.85}
            onPress={() => choose(opt.mode)}
            disabled={setMode.isPending}
          >
            <View style={[styles.iconWrap, { backgroundColor: (active ? COLORS.emerald : COLORS.textSecondary) + '22' }]}>
              <Ionicons name={opt.icon as any} size={20} color={active ? COLORS.emerald : COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{opt.title}</Text>
              <Text style={styles.cardDesc}>{opt.desc}</Text>
            </View>
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? COLORS.emerald : COLORS.textSecondary}
            />
          </TouchableOpacity>
        );
      })}

      {/* Aperçu AVANT validation : impact du changement sur le mois en cours. Les transactions ne
          sont jamais modifiées — seule leur lecture dans TON budget change (réversible). */}
      {pendingMode && (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>Si tu valides :</Text>
          {pendingMode === 'contribution' ? (
            <>
              <Text style={styles.previewLine}>
                • Tes virements vers ce compte comptent comme des <Text style={styles.previewStrong}>dépenses</Text>
                {myTransfers > 0 ? ` (ce mois : ${eur(myTransfers)})` : ''}
              </Text>
              <Text style={styles.previewLine}>
                • Ses opérations internes ne comptent <Text style={styles.previewStrong}>plus</Text> dans ton budget
                {internalPart > 0 ? ` (−${eur(internalPart)} de dépenses ce mois)` : ''}
              </Text>
              <Text style={styles.previewLine}>• Ta part du solde reste comptée dans ton patrimoine</Text>
            </>
          ) : (
            <>
              <Text style={styles.previewLine}>
                • Ses dépenses comptent dans ton budget à hauteur de ta part{pct != null ? ` (${pct} %)` : ''}
                {internalPart > 0 ? ` (+${eur(internalPart)} ce mois)` : ''}
              </Text>
              <Text style={styles.previewLine}>
                • Tes virements vers ce compte redeviennent <Text style={styles.previewStrong}>neutres</Text>
                {myTransfers > 0 ? ` (−${eur(myTransfers)} de dépenses ce mois)` : ''}
              </Text>
            </>
          )}
          <View style={styles.previewBtns}>
            <TouchableOpacity style={styles.previewCancel} onPress={() => setPendingMode(null)}>
              <Text style={styles.previewCancelText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.previewOk} onPress={confirmMode} disabled={setMode.isPending}>
              {setMode.isPending ? <ActivityIndicator color={COLORS.onAccent} size="small" /> : <Text style={styles.previewOkText}>Valider</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {current === null && !pendingMode && (
        <Text style={styles.hint}>
          Non défini pour l’instant → traité comme « Suivi partagé » (comportement actuel). Choisis pour préciser.
        </Text>
      )}
      {isLoading && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 8 }} />}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    section: { marginTop: 18 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 3, marginBottom: 10, lineHeight: 17 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 12, marginBottom: 8,
      backgroundColor: c.card,
    },
    iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    cardDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    hint: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', marginTop: 2 },
    /* Aperçu avant validation du changement de mode */
    previewBox: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '44', padding: 12, marginTop: 4, gap: 6 },
    previewTitle: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    previewLine: { fontSize: 12.5, color: c.text, lineHeight: 18 },
    previewStrong: { fontWeight: '800', color: c.text },
    previewBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
    previewCancel: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder },
    previewCancelText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    previewOk: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: c.emerald },
    previewOkText: { fontSize: 13, fontWeight: '800', color: c.onAccent },
  });
}
