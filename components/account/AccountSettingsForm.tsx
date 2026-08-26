/**
 * AccountSettingsForm — les réglages d'un compte, en UN SEUL endroit.
 *
 * Le même formulaire sert désormais l'onglet « Paramètres » de la fiche du compte et la route
 * `/comptes/edit/[id]` (encore utilisée juste après la création, pour enchaîner sur le partage).
 * Il vivait auparavant en entier dans cette route : la fiche devait donc envoyer l'utilisateur sur
 * un AUTRE écran pour renommer un compte, via un bouton « Modifier » qui occupait le haut de page.
 *
 * Il ne rend PAS son propre défilement : l'appelant le pose dans le sien (un ScrollView dans un
 * ScrollView se dispute le geste vertical).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { useUpdateAccount, useCloseAccount, useSetDefaultAccount } from '../../hooks/data/useAccounts';
import { useFiscalEnvelopeRates } from '../../hooks/data/useFiscalEnvelopes';
import { useAppColors } from '../../hooks/theme/useAppColors';
import type { AppColors } from '../../theme/palette';
import type { Account, AccountType } from '../../types/database';
import AccountShareSection from './AccountShareSection';
import AccountImpactSection from './AccountImpactSection';
import AccountModeSection from './AccountModeSection';

/** Le nom du compte s'affiche chez les AUTRES membres d'un compte partagé : il lui faut une borne. */
const ACCOUNT_NAME_MAX = 40;

const TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Courant' },
  { value: 'savings', label: 'Épargne' },
  { value: 'investment', label: 'Investissement' },
  { value: 'other', label: 'Autre' },
];

export default function AccountSettingsForm({ account, onSaved, onError }: {
  account: Account;
  /** Appelé après un enregistrement réussi (la route `edit` revient en arrière ; l'onglet reste). */
  onSaved?: () => void;
  /** Remonte l'erreur à l'appelant (qui peut vouloir remonter en haut de SON défilement). */
  onError?: (message: string) => void;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { user } = useAuth();
  const updateAccount = useUpdateAccount(user?.id);
  const closeAccount = useCloseAccount(user?.id);
  const setDefaultAccount = useSetDefaultAccount(user?.id);
  const { data: fiscalRates = [] } = useFiscalEnvelopeRates();
  /* Consultation admin : renommer, changer le type, désigner le compte principal ou FERMER le
     compte écrivent tous sur le compte visité (la politique d'accès l'autorise). Une fermeture y
     archiverait — voire supprimerait — le compte de quelqu'un d'autre. */
  const roGuard = useReadOnlyGuard();

  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const [fiscalEnvelope, setFiscalEnvelope] = useState<string>((account as any).fiscal_envelope ?? 'pea');
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le compte peut changer sous nos pieds (refetch, realtime d'un compte partagé) : on resynchronise
  // les champs tant que l'utilisateur n'a rien modifié de plus récent que ce que la base connaît.
  useEffect(() => {
    setName(account.name);
    setType(account.type);
    setFiscalEnvelope((account as any).fiscal_envelope ?? 'pea');
  }, [account.id, account.name, account.type, (account as any).fiscal_envelope]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const fail = (message: string) => {
    setFormError(message);
    onError?.(message);
  };

  async function handleSubmit() {
    if (roGuard.blocked()) return;
    setFormError(null);
    setNameError(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      fail('Le nom du compte est obligatoire.');
      return;
    }
    try {
      await updateAccount.mutateAsync({
        id: account.id,
        name: trimmed,
        type,
        currency: account.currency || 'EUR',
        fiscal_envelope: type === 'investment' ? fiscalEnvelope : null,
      });
      // Confirmation SUR PLACE : dans l'onglet Paramètres, l'utilisateur ne quitte pas l'écran —
      // sans retour visible, il ne saurait pas si son changement est parti.
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2200);
      onSaved?.();
    } catch (e: unknown) {
      fail(e instanceof Error ? e.message : "Impossible d'enregistrer.");
    }
  }

  const doClose = () => {
    closeAccount.mutateAsync(account.id).then(() => {
      // Le compte vient d'être supprimé/archivé : ne PAS rester sur sa fiche (qui bouclerait sur
      // « Chargement… »). On vide la pile Comptes jusqu'à la liste.
      const r = router as any;
      if (typeof r.dismissAll === 'function') r.dismissAll();
      else router.replace('/(tabs)/comptes');
    }).catch((e: unknown) => {
      fail(e instanceof Error ? e.message : 'Impossible de fermer le compte.');
    });
  };

  function handleClose() {
    if (roGuard.blocked()) return;
    const isJoint = !!(account as any).is_joint;
    Alert.alert(
      isJoint ? 'Fermer le compte joint' : 'Fermer le compte',
      isJoint
        ? "Ce compte joint sera fermé pour TOUS les membres. S'il contient des écritures, il sera archivé (plus utilisable) ; vide, il sera supprimé. Pour le supprimer définitivement, supprime d'abord toutes ses transactions. Confirmer ?"
        : "Un compte avec des écritures sera archivé (visible en bas de la liste). Un compte sans écriture sera supprimé. Tu ne pourras plus l'utiliser pour des virements ou nouvelles transactions. Confirmer ?",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Fermer le compte', style: 'destructive', onPress: doClose },
      ],
    );
  }

  return (
    <View>
      {!!formError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{formError}</Text>
        </View>
      )}

      <Text style={styles.label}>Nom du compte *</Text>
      <TextInput
        style={[styles.input, nameError && styles.inputError]}
        value={name}
        onChangeText={(v) => { setName(v); setNameError(false); setFormError(null); }}
        placeholder="Ex. Compte courant"
        placeholderTextColor={COLORS.textSecondary}
        maxLength={ACCOUNT_NAME_MAX}
        editable={account._role === 'owner' && !roGuard.readOnly}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[styles.chip, type === t.value && styles.chipActive]}
            onPress={() => setType(t.value)}
            disabled={account._role !== 'owner'}
          >
            <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === 'investment' && (
        <>
          <Text style={styles.label}>Enveloppe fiscale</Text>
          <View style={styles.chipRow}>
            {fiscalRates.map((r) => (
              <TouchableOpacity
                key={r.envelope}
                style={[styles.chip, fiscalEnvelope === r.envelope && styles.chipActive]}
                onPress={() => setFiscalEnvelope(r.envelope)}
                disabled={account._role !== 'owner'}
              >
                <Text style={[styles.chipText, fiscalEnvelope === r.envelope && styles.chipTextActive]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={styles.infoRow}>
        <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
        <Text style={styles.infoText}>Le solde ne peut être modifié que via des transactions.</Text>
      </View>

      {/* Compte courant PAR DÉFAUT (migration 146) — pré-sélectionné à la saisie, en tête des listes. */}
      {type === 'checking' && account._role === 'owner' && !account.is_joint && (
        <TouchableOpacity
          style={styles.defaultRow}
          onPress={() => { if (roGuard.blocked()) return; setDefaultAccount.mutate(account.is_default ? null : account.id); }}
          disabled={setDefaultAccount.isPending}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!account.is_default }}
        >
          <Ionicons
            name={account.is_default ? 'checkbox' : 'square-outline'}
            size={20}
            color={account.is_default ? COLORS.emerald : COLORS.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.defaultLabel}>Compte principal</Text>
            <Text style={styles.defaultHint}>
              Pré-sélectionné quand tu saisis une transaction, et affiché en premier dans les listes.
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Partage / membres (owner uniquement ; gate flag pour les comptes perso) */}
      <AccountShareSection account={account} />
      {/* #5 — % d'impact de chaque participant (visible par tout participant) */}
      <AccountImpactSection account={account} />
      {/* Périmètre quotidien : mode d'usage du compte (par participant) */}
      <AccountModeSection account={account} />

      {account._role === 'owner' ? (
        <>
          <TouchableOpacity
            style={[styles.submitBtn, (updateAccount.isPending || saved) && styles.submitBtnBusy]}
            onPress={handleSubmit}
            disabled={updateAccount.isPending}
            accessibilityRole="button"
          >
            {updateAccount.isPending ? (
              <ActivityIndicator color={COLORS.onAccent} />
            ) : saved ? (
              <View style={styles.submitDone}>
                <Ionicons name="checkmark" size={18} color={COLORS.onAccent} />
                <Text style={styles.submitLabel}>Enregistré</Text>
              </View>
            ) : (
              <Text style={styles.submitLabel}>Enregistrer</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.closeBtn, closeAccount.isPending && styles.submitBtnBusy]}
            onPress={handleClose}
            disabled={closeAccount.isPending}
            accessibilityRole="button"
          >
            {closeAccount.isPending
              ? <ActivityIndicator color={COLORS.danger} />
              : <Text style={styles.closeBtnLabel}>Fermer le compte</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.infoRow}>
          <Ionicons name="lock-closed-outline" size={16} color={COLORS.textSecondary} />
          <Text style={styles.infoText}>
            Compte partagé : seul son propriétaire peut le renommer ou le fermer. Tu peux saisir/éditer des transactions selon ton rôle.
          </Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 20,
    },
    inputError: { borderColor: c.danger },
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start',
      backgroundColor: c.danger + '1F', borderWidth: 1, borderColor: c.danger + '66',
      borderRadius: 10, padding: 12, marginBottom: 20,
    },
    errorBannerText: { flex: 1, fontSize: 13, color: c.danger, lineHeight: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
    chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipText: { fontSize: 14, color: c.text },
    chipTextActive: { color: c.onAccent, fontWeight: '600' },
    infoRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, padding: 14, borderRadius: 10,
      borderWidth: 1, borderColor: c.cardBorder, marginBottom: 20,
    },
    infoText: { fontSize: 13, color: c.textSecondary, flex: 1 },
    defaultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, marginTop: 4 },
    defaultLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    defaultHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 2 },
    submitBtn: { backgroundColor: c.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    submitBtnBusy: { opacity: 0.75 },
    submitDone: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    submitLabel: { fontSize: 16, fontWeight: '700', color: c.onAccent },
    closeBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: c.danger, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    closeBtnLabel: { fontSize: 16, fontWeight: '600', color: c.danger },
  });
}
