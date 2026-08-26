/**
 * QuickAccountsModal — création RAPIDE de plusieurs comptes d'un coup.
 *
 * Reprend le principe de l'écran « Autres comptes » de l'ancien démarrage : on ajoute
 * des lignes en un tap depuis des propositions, on met un nom et un solde, et tout part en une fois.
 * Pas d'enveloppe fiscale, pas de date d'ouverture — ces détails se complètent plus tard dans la
 * fiche du compte. Le but ici est d'avoir vite des soldes réels, seule condition pour que le Relyka
 * et les recommandations veuillent dire quelque chose.
 *
 * Le premier compte COURANT créé devient le compte principal (`is_default`) si l'utilisateur n'en a
 * pas encore : c'est celui que la saisie proposera par défaut.
 */
import { useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAccounts, useAddAccount } from '../../hooks/data/useAccounts';
import { useProfile } from '../../hooks/data/useProfile';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { currencySymbolFor } from '../../lib/finance/currency';
import { appAlert } from '../../lib/ui/appDialog';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import { sanitizeAmountInput, sanitizeSignedAmountInput } from '../../lib/ui/amountInput';

/** Le nom du compte s'affiche chez les AUTRES membres d'un compte partagé : il lui faut une borne. */
const ACCOUNT_NAME_MAX = 40;

/** Propositions ajoutables en un tap (mêmes intitulés que le démarrage). */
const PRESETS: { key: string; label: string; type: string; hint: string; icon: string }[] = [
  { key: 'courant',  label: 'Compte courant',       type: 'checking',   hint: 'Le quotidien',            icon: 'wallet-outline' },
  { key: 'courant2', label: 'Autre compte courant', type: 'checking',   hint: 'Second compte',           icon: 'wallet-outline' },
  { key: 'livret',   label: 'Livret A',             type: 'savings',    hint: 'Épargne disponible',      icon: 'leaf-outline' },
  { key: 'ldds',     label: 'LDDS',                 type: 'savings',    hint: 'Épargne disponible',      icon: 'leaf-outline' },
  { key: 'autreEp',  label: 'Autre épargne',        type: 'savings',    hint: 'PEL, CEL, livret bancaire', icon: 'leaf-outline' },
  { key: 'invest',   label: 'PEA ou compte-titres', type: 'investment', hint: 'Placements',              icon: 'trending-up-outline' },
  { key: 'autreInv', label: 'Autre investissement', type: 'investment', hint: 'Assurance-vie, crypto, SCPI…', icon: 'trending-up-outline' },
];

interface Row { key: string; label: string; type: string; amount: string }

interface Props {
  visible: boolean;
  userId?: string;
  onClose: () => void;
  /** Appelé après création réussie (nombre de comptes créés). */
  onCreated?: (count: number) => void;
}

export default function QuickAccountsModal({ visible, userId, onClose, onCreated }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: profile } = useProfile(userId);
  const { data: accounts = [] } = useAccounts(userId);
  const addAccount = useAddAccount(userId);
  /* Verrou SYNCHRONE. `busy` est un état React : il ne ferme le bouton qu'au rendu SUIVANT, et ici
     chaque compte part en un aller-retour réseau séparé. Deux appuis rapprochés lançaient donc DEUX
     lots complets — et comme les noms en double sont suffixés (« Livret A 2 »), on se retrouvait
     avec une liste de comptes fantômes qu'il fallait fermer un par un. */
  const submitLock = useSubmitLock();
  /* Consultation admin : ces comptes seraient créés sur le profil visité. */
  const roGuard = useReadOnlyGuard();

  const currency = profile?.currency_code ?? 'EUR';
  const symbol = currencySymbolFor(currency);

  // Première ouverture : on amorce avec un compte courant, la ligne que tout le monde a.
  const [rows, setRows] = useState<Row[]>([{ key: 'courant-0', label: 'Compte courant', type: 'checking', amount: '' }]);
  const [busy, setBusy] = useState(false);
  /* Avancement de la création. Les comptes sont insérés UN PAR UN (chacun recalcule son solde) :
     sur un téléphone, ça prend un instant visible. Le formulaire cède donc la place à une carte
     d'attente qui DIT ce qui se passe — avant, la feuille restait affichée, figée, et on ne savait
     pas si le tap avait été pris en compte. */
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const num = (s: string) => {
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const incomplete = rows.filter((r) => !r.label.trim());
  const canSave = rows.length > 0 && incomplete.length === 0 && !busy;

  const add = (p: typeof PRESETS[number]) =>
    setRows((prev) => [...prev, { key: `${p.key}-${prev.length}-${Date.now()}`, label: p.label, type: p.type, amount: '' }]);

  async function save() {
    if (!canSave) return;
    if (roGuard.blocked()) return;
    if (!submitLock.acquire()) return;
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    let created = 0;
    /* ── ÉCHEC AU MILIEU DU LOT : ON GARDE CE QUI EST PASSÉ ────────────────────────────────────
       Les comptes partent l'un après l'autre. Quand le quatrième échouait, le message disait
       seulement « Impossible de créer ces comptes » — au pluriel, alors que trois venaient d'être
       créés — et le formulaire gardait ses SEPT lignes. Réessayer recréait les trois premiers, cette
       fois suffixés (« Compte courant 2 ») puisque les doublons de nom sont refusés : on repartait
       avec le double de comptes, tous à moitié faux.
       On retire donc les lignes réellement créées avant de rendre la main. */
    try {
      // Compte principal : seulement si l'utilisateur n'en a pas déjà un.
      let needsDefault = !accounts.some((a: any) => a.type === 'checking' && a.is_default);
      // Les propositions se ressemblent (deux « Autre épargne »…) et la création REFUSE les doublons
      // de nom : on suffixe au lieu d'échouer au milieu du lot.
      const taken = new Set(accounts.map((a: any) => String(a.name).trim().toLowerCase()));
      for (const r of rows) {
        const base = r.label.trim();
        let name = base;
        for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
        taken.add(name.toLowerCase());
        const isFirstChecking = r.type === 'checking' && needsDefault;
        await addAccount.mutateAsync({
          name, type: r.type, currency, balance: num(r.amount),
          ...(isFirstChecking ? { is_default: true } : {}),
        } as any);
        if (isFirstChecking) needsDefault = false;
        created += 1;
        setProgress({ done: created, total: rows.length });
      }
      setRows([]);
      onCreated?.(created);
      onClose();
    } catch (e: any) {
      if (created > 0) {
        setRows((prev) => prev.slice(created)); // ce qui est créé ne doit pas repartir
        onCreated?.(created);
      }
      appAlert({
        title: 'Un souci',
        message: (created > 0
          ? `${created} compte${created > 1 ? 's ont' : ' a'} bien été créé${created > 1 ? 's' : ''}. La suite n'est pas passée : `
          : '') + (e?.message ?? "impossible de créer ces comptes."),
      });
    } finally {
      submitLock.release();
      setBusy(false);
    }
  }

  /* ATTENTE : le formulaire disparaît dès la validation et laisse une carte compacte qui montre
     l'avancement. Le tap est ainsi confirmé tout de suite, et la fermeture ne se fait qu'une fois
     les comptes réellement créés — on ne rend jamais la main sur une liste encore vide. */
  if (visible && busy) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={[styles.card, styles.waitCard]}>
            <ActivityIndicator size="large" color={COLORS.emerald} />
            <Text style={styles.waitTitle}>Création de tes comptes…</Text>
            <Text style={styles.waitSub}>
              {progress.total > 1 ? `${progress.done} sur ${progress.total}` : 'Encore un instant.'}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAwareOverlay style={styles.overlay} scroll={false}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Création rapide</Text>
              <Text style={styles.sub}>Ajoute tous tes comptes d'un coup, avec leur solde d'aujourd'hui.</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 4 }} accessibilityLabel="Fermer">
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {rows.map((r, i) => (
              <View key={r.key} style={styles.row}>
                <View style={[styles.typeDot, { backgroundColor: typeColor(r.type, COLORS) + '22' }]}>
                  <Ionicons
                    name={(r.type === 'savings' ? 'leaf' : r.type === 'investment' ? 'trending-up' : 'wallet') as any}
                    size={15}
                    color={typeColor(r.type, COLORS)}
                  />
                </View>
                <TextInput
                  style={styles.name}
                  value={r.label}
                  onChangeText={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, label: v } : x)))}
                  placeholder="Nom du compte"
                  placeholderTextColor={COLORS.textSecondary}
                  maxLength={ACCOUNT_NAME_MAX}
                  selectionColor={COLORS.emerald}
                />
                {/* Montant + devise dans une boîte de largeur FIXE : le nom (flexible) s'y adapte.
                    Avec trois éléments flexibles côte à côte, la ligne débordait de la carte sur
                    les écrans étroits — le montant et la croix passaient hors champ. */}
                <View style={styles.amountBox}>
                  <TextInput
                    style={styles.amount}
                    value={r.amount}
                    onChangeText={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, amount: sanitizeSignedAmountInput(v) } : x)))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={COLORS.textSecondary}
                    selectionColor={COLORS.emerald}
                  />
                  <Text style={styles.unit}>{symbol}</Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setRows((prev) => prev.filter((_, j) => j !== i))} hitSlop={8} style={{ padding: 2 }}>
                  <Ionicons name="close-circle" size={19} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={styles.label}>Ajouter en un tap</Text>
            <View style={styles.chips}>
              {PRESETS.map((p) => (
                <TouchableOpacity key={p.key} style={styles.chip} activeOpacity={0.8} onPress={() => add(p)}>
                  <Ionicons name={p.icon as any} size={14} color={typeColor(p.type, COLORS)} />
                  <Text style={styles.chipText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.hint}>
              Tu pourras mettre à jour tes comptes à tout moment.
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.cta, !canSave && styles.ctaOff]}
            onPress={save}
            disabled={!canSave}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={COLORS.onAccent} />
            ) : (
              <>
                <Text style={styles.ctaLabel}>
                  {rows.length > 1 ? `Créer mes ${rows.length} comptes` : 'Créer mon compte'}
                </Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.onAccent} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAwareOverlay>
    </Modal>
  );
}

function typeColor(type: string, c: any): string {
  return type === 'savings' ? c.savings : type === 'investment' ? c.investment : c.checking;
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    card: {
      width: '100%', maxWidth: 420, backgroundColor: c.cardSolid, borderRadius: 24,
      borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 12,
    },
    // Carte d'ATTENTE : elle remplace le formulaire pendant la création.
    waitCard: { alignItems: 'center', gap: 12, paddingVertical: 30 },
    waitTitle: { fontSize: 16, fontWeight: '800', color: c.text },
    waitSub: { fontSize: 13, color: c.textSecondary },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    title: { fontSize: 19, fontWeight: '800', color: c.text },
    sub: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 3 },

    row: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
    },
    typeDot: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    // `minWidth: 0` : sans lui, un TextInput refuse de descendre sous la largeur de son contenu et
    // pousse le reste de la ligne hors de la carte.
    name: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '600', color: c.text, padding: 0 },
    amountBox: { width: 92, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    amount: { flex: 1, fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'right', padding: 0 },
    unit: { fontSize: 13, fontWeight: '700', color: c.textSecondary },

    label: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    chipText: { fontSize: 13, fontWeight: '600', color: c.text },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 12 },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 15,
    },
    ctaOff: { opacity: 0.45 },
    ctaLabel: { fontSize: 15.5, fontWeight: '800', color: c.onAccent },
  });
}
