/**
 * RÉGLAGE DE LA RÉPARTITION — « selon mon profil » ou « mes pourcentages ».
 *
 * Le Relyka se répartit entre quatre décisions, et ces pourcentages viennent du PROFIL FINANCIER.
 * C'est le bon réglage par défaut : il se déduit des données réelles et il suit la situation. Mais
 * quelqu'un qui sait exactement ce qu'il veut faire de son surplus n'avait aucun moyen de le dire.
 *
 * Cette modale est ce moyen — et elle dit aussi ce que ce choix implique, sans le déconseiller :
 * une répartition posée à la main ne bouge plus quand la situation bouge.
 *
 * ⚠️ CE QUE CET ÉCRAN MONTRE EST, LITTÉRALEMENT, CE QUI S'APPLIQUE.
 * Un étage « priorité du mois » réécrivait ces pourcentages avant de les appliquer : quelqu'un qui
 * posait 20 % d'épargne en voyait arriver 10, plus deux autres postes décalés par le report des
 * points libérés — trois chiffres qu'il n'avait choisis nulle part. Cet étage a été retiré, et avec
 * lui le bloc qui tentait de l'expliquer ici. La répartition passe désormais par `appliedAllocation`
 * (lib/recoMode), le même point d'entrée que le moteur de recommandations.
 *
 * Elle est montée depuis DEUX écrans (le tableau de bord et la page « Profil financier ») : elle
 * lit donc ses données elle-même. Toutes viennent du cache react-query, aucun aller-retour réseau.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, TextInput, StyleSheet, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useProfile, useUpdateProfile } from '../../hooks/data/useProfile';
import { useFinancialProfile, useProfileAllocations } from '../../hooks/pilotage/useFinancialProfile';
import { PROFILE_INFO, resolveProfileId } from '../../lib/finance/financialProfileEngine';
import { RECO_KEYS, RECO_KEY_LABEL, allocationTotal, appliedAllocation, readManualAllocation, resolveRecoMode, type Allocation, type RecoKey, type RecoMode } from '../../lib/finance/recoMode';
import { useRecoAdjustments, type RecoAdjustmentKind } from '../../hooks/pilotage/useRecoAdjustments';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
}

/** Pas d'un appui sur « − » / « + ». Cinq points : assez gros pour arriver vite, assez fin pour viser. */
const STEP = 5;

/* ── LES EXCEPTIONS, EN FRANÇAIS ────────────────────────────────────────────────────────────────
   Un libellé court (le NOM de ce qui se passe) et une phrase qui dit ce que ça fait aux montants.
   Volontairement descriptives et sans reproche : aucune de ces situations n'est une erreur, et
   aucune ne demande d'action ici — elles expliquent seulement un écart que l'utilisateur constate. */
const ADJUSTMENT_LABEL: Record<RecoAdjustmentKind, string> = {
  margin_freeze: 'Solde sous ta marge de sécurité',
  projection_freeze: 'Trajectoire sous ta marge',
  projection_guard: 'Plafond lié à ta trajectoire',
  cascade: 'Budget variable dépassé',
  already_allocated: 'Déjà mis de côté ce mois-ci',
  crumbs: 'Montant trop petit pour être découpé',
  single_fallback: 'Trop peu à répartir',
};

const ADJUSTMENT_TEXT: Record<RecoAdjustmentKind, string> = {
  margin_freeze:
    'ton compte courant est en dessous de la marge que tu t’es fixée. Tant que c’est le cas, on te recommande de « Conserver » à 100%.',
  projection_freeze:
    'ton solde prévu passe sous ta marge dans les prochains mois. Tant que c’est le cas, on te recommande de « Conserver » à 100%.',
  projection_guard:
    'épargner et investir la totalité ferait passer ton solde prévu sous ta marge. La part en trop est basculée sur « Conserver ».',
  cascade:
    'tu as dépensé plus que ton budget variable habituel. Le dépassement est retiré des recommandations, en commençant par « Confort ».',
  already_allocated:
    'ce que tu as déjà viré, réservé ou cumulé est déduit de la recommandation correspondante.',
  crumbs:
    'une recommandation tombait sous son seuil d’affichage. Son montant n’est pas perdu : il rejoint une autre recommandation.',
  single_fallback:
    'ton reste du mois est trop petit pour être découpé en quatre. Une seule proposition est faite : tout conserver.',
};

/** Entier 0–100 depuis une saisie libre (le champ ne doit jamais afficher autre chose qu'un nombre). */
function sanitizePercent(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  if (digits === '') return '';
  return String(Math.min(100, parseInt(digits, 10)));
}

export default function RecoModeModal({ visible, onClose, userId }: Props) {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isImpersonating } = useAuth();

  const { data: profile } = useProfile(userId);
  const { data: fp } = useFinancialProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  /* La table RÉGLÉE en administration : la colonne « App » doit montrer ce que le moteur applique. */
  const { data: allocTable } = useProfileAllocations();

  const profileId = resolveProfileId((fp as any)?.profile_id);
  const info = PROFILE_INFO[profileId];
  /** Ce que l'app recommande pour ce palier — la référence affichée en face de chaque poste.
   *  Même point d'entrée que le moteur (`appliedAllocation`) : la colonne « App » ne peut donc pas
   *  annoncer autre chose que ce qui serait appliqué en repassant en automatique. */
  const autoBase: Allocation = appliedAllocation(profileId, null, allocTable);

  const saved = useMemo(() => resolveRecoMode(profile), [profile]);
  /* Les exceptions RÉELLEMENT en cours — telles que le moteur les a consignées en calculant les
     recommandations affichées, avec exactement ses entrées (cf. useRecoAdjustments). */
  const adjustments = useRecoAdjustments(userId);

  const [mode, setMode] = useState<RecoMode>('auto');
  const [draft, setDraft] = useState<Allocation>(autoBase);
  const [saving, setSaving] = useState(false);

  /* À CHAQUE OUVERTURE on repart de l'enregistré : la modale sert plusieurs fois par session, et
     rouvrir sur un brouillon abandonné laisserait croire qu'il a été enregistré.
     Point de départ d'un premier passage en manuel : la répartition de l'app. On ne demande pas à
     quelqu'un de composer 100 % à partir de rien — il ajuste ce qu'il avait déjà. */
  useEffect(() => {
    if (!visible) return;
    setMode(saved.mode);
    setDraft(readManualAllocation(profile) ?? autoBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const total = allocationTotal(draft);
  const rest = 100 - total;
  const canSave = mode === 'auto' || total === 100;

  const setKey = (k: RecoKey, value: number) =>
    setDraft((d) => ({ ...d, [k]: Math.max(0, Math.min(100, Math.round(value))) }));

  /* ── PLUS RIEN À ANNONCER ICI ───────────────────────────────────────────────────────────────
     Un bloc expliquait, sous les curseurs, que la « priorité du mois » allait réécrire ces
     pourcentages avant de les appliquer. Cet étage n'existe plus : ce que l'écran montre est,
     littéralement, ce que le moteur applique. Le bloc n'avait donc plus rien à dire. */

  async function handleSave() {
    if (isImpersonating) {
      Alert.alert(
        'Consultation seule',
        "Tu es connecté en tant qu'un autre utilisateur : cet écran est en lecture seule. Rien n'est modifié sur son compte.",
      );
      return;
    }
    if (!canSave) return;
    setSaving(true);
    try {
      /* En repassant en automatique on GARDE les pourcentages choisis en base : y revenir plus tard
         ne doit pas demander de tout ressaisir. Seul le mode change. */
      await updateProfile.mutateAsync(
        mode === 'manual'
          ? {
              reco_mode: 'manual',
              manual_alloc_save_percent: draft.save,
              manual_alloc_invest_percent: draft.invest,
              manual_alloc_enjoy_percent: draft.enjoy,
              manual_alloc_keep_percent: draft.keep,
            }
          : { reco_mode: 'auto' },
      );
      onClose();
    } catch (e: unknown) {
      Alert.alert('Un souci', (e as any)?.message ?? 'Impossible d’enregistrer ce réglage.');
    } finally {
      setSaving(false);
    }
  }

  const colorOf: Record<RecoKey, string> = {
    save: COLORS.green ?? COLORS.emerald,
    invest: COLORS.violet,
    enjoy: COLORS.orange,
    keep: COLORS.blue,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAwareOverlay style={s.overlay} onBackdropPress={onClose}>
        <Pressable style={s.box} onPress={() => {}}>

          <View style={s.header}>
            <Text style={s.title}>Répartition de tes recommandations</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <Text style={s.lead}>
            Ces pourcentages décident de la façon dont ton Relyka se répartit entre les quatre
            décisions.
          </Text>

          {/* LE PROFIL EN COURS, à part et toujours visible. Il était noyé dans la phrase
              d'explication : c'est pourtant la donnée qu'on vient vérifier ici — « selon mon
              profil », oui, mais lequel ? Elle reste affichée dans les deux modes, parce qu'en
              manuel elle dit ce qu'on a mis de côté. */}
          {!!info && (
            <View style={[s.profileRow, { borderColor: info.color + '55', backgroundColor: info.color + '12' }]}>
              <Text style={s.profileEmoji}>{info.emoji}</Text>
              <Text style={s.profileLabel} numberOfLines={1}>
                Ton profil : <Text style={[s.profileName, { color: info.color }]}>{info.name}</Text>
              </Text>
            </View>
          )}

          {/* ── Le choix, en deux options exclusives ── */}
          <View style={s.segment}>
            {([
              { key: 'auto' as const, label: 'Selon mon profil', icon: 'sparkles-outline' as const },
              { key: 'manual' as const, label: 'Mes pourcentages', icon: 'options-outline' as const },
            ]).map((opt) => {
              const active = mode === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.segmentBtn, active && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '1A' }]}
                  onPress={() => setMode(opt.key)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons name={opt.icon} size={15} color={active ? COLORS.emerald : COLORS.textSecondary} />
                  <Text style={[s.segmentText, active && { color: COLORS.emerald }]} numberOfLines={1}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* INFORMATION, pas avertissement — et UNE EXPLICATION PAR MODE : une phrase unique qui
              décrivait les deux obligeait à lire ce qui ne concernait pas le choix en cours, et
              enterrait l'essentiel au milieu. Chaque option dit ce qu'ELLE fait, au moment où on
              la regarde. Aucun ton d'alerte : les deux sont des réglages légitimes. */}
          <View style={s.info}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.teal} />
            <Text style={s.infoText}>
              {mode === 'auto'
                ? 'Relyka calcule cette répartition à partir de ton profil et de ta situation du mois. Elle se réajuste toute seule quand tes données bougent — c’est ce qui la rend en général la plus fiable.'
                : 'Tes pourcentages sont appliqués tels que tu les poses : Relyka ne les corrige pas, même quand ta situation du mois appellerait autre chose. C’est toi qui les feras évoluer.'}
            </Text>
          </View>

          {/* ── Les quatre postes ── */}
          <View style={s.rows}>
            {/* La colonne de référence n'apparaît qu'en manuel : en automatique, elle répéterait
                exactement la colonne d'à côté — deux fois le même chiffre sous deux noms. */}
            <View style={s.rowHead}>
              <Text style={[s.rowHeadCell, { flex: 1 }]}>Décision</Text>
              {mode === 'manual' && <Text style={[s.rowHeadCell, s.refCol]}>App</Text>}
              <Text style={[s.rowHeadCell, s.editCol]}>{mode === 'manual' ? 'Le tien' : 'Réparti'}</Text>
            </View>

            {RECO_KEYS.map((k) => (
              <View key={k} style={s.row}>
                <View style={s.rowLabelCol}>
                  <View style={[s.dot, { backgroundColor: colorOf[k] }]} />
                  <Text style={s.rowLabel} numberOfLines={1}>{RECO_KEY_LABEL[k]}</Text>
                </View>

                {/* La référence de l'app reste visible EN MODE MANUEL : c'est la comparaison
                    demandée — on voit ce dont on s'écarte, poste par poste. */}
                {mode === 'manual' && <Text style={[s.refValue, s.refCol]}>{autoBase[k]} %</Text>}

                {mode === 'manual' ? (
                  <View style={[s.stepper, s.editCol]}>
                    <TouchableOpacity
                      style={s.stepBtn}
                      onPress={() => setKey(k, draft[k] - STEP)}
                      accessibilityRole="button"
                      accessibilityLabel={`Diminuer ${RECO_KEY_LABEL[k]}`}
                    >
                      <Ionicons name="remove" size={16} color={COLORS.text} />
                    </TouchableOpacity>
                    <TextInput
                      style={[s.pctInput, { color: colorOf[k] }]}
                      value={String(draft[k])}
                      onChangeText={(v) => setKey(k, parseInt(sanitizePercent(v) || '0', 10))}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      maxLength={3}
                      accessibilityLabel={`${RECO_KEY_LABEL[k]} en pourcentage`}
                    />
                    <TouchableOpacity
                      style={s.stepBtn}
                      onPress={() => setKey(k, draft[k] + STEP)}
                      accessibilityRole="button"
                      accessibilityLabel={`Augmenter ${RECO_KEY_LABEL[k]}`}
                    >
                      <Ionicons name="add" size={16} color={COLORS.text} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={[s.autoValue, s.editCol, { color: colorOf[k] }]}>{autoBase[k]} %</Text>
                )}
              </View>
            ))}
          </View>

          {/* ── Le total : la seule contrainte, et elle est affichée en permanence ── */}
          {mode === 'manual' && (
            <View style={s.totalRow}>
              <Text style={[s.totalText, { color: total === 100 ? COLORS.emerald : COLORS.orange }]}>
                {total === 100
                  ? 'Total : 100 %'
                  : rest > 0
                    ? `Il te reste ${rest} % à répartir`
                    : `${-rest} % de trop`}
              </Text>
              {total !== 100 && (
                <TouchableOpacity
                  onPress={() => setKey('keep', draft.keep + rest)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={s.totalFix}>
                    {rest > 0 ? 'Mettre le reste sur Conserver' : 'Retirer de Conserver'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── POURQUOI TES RECOS NE TOMBENT PAS SUR CES POURCENTAGES ─────────────────────────────
              Affiché UNIQUEMENT si une exception s'applique réellement en ce moment (liste tenue
              par le moteur lui-même en calculant, cf. `ComputeRecoOptions.trace`). Rien à signaler
              → rien à l'écran : ces pourcentages sont alors appliqués à la lettre, et une note
              permanente ne ferait qu'inquiéter sans raison.
              Ce n'est plus l'app qui réécrit les pourcentages (priorités et modificateurs ont été
              retirés) : ce sont des FAITS du mois qui déplacent des MONTANTS. */}
          {adjustments.length > 0 && (
            <View style={s.except}>
              <View style={s.exceptHead}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.teal} />
                <Text style={s.exceptTitle}>
                  Tes montants ne suivent pas exactement ces pourcentages
                </Text>
              </View>
              {adjustments.map((k) => (
                <View key={k} style={s.exceptRow}>
                  <Text style={s.exceptBullet}>•</Text>
                  <Text style={s.exceptText}>
                    <Text style={s.b}>{ADJUSTMENT_LABEL[k]}</Text> — {ADJUSTMENT_TEXT[k]}
                  </Text>
                </View>
              ))}
              <Text style={s.exceptFoot}>
                Tes pourcentages, eux, ne bougent pas : ils s’appliqueront lors du retour à la normal de ta situation.
              </Text>
            </View>
          )}

          <View style={s.actions}>
            <TouchableOpacity style={s.cancel} onPress={onClose} accessibilityRole="button">
              <Text style={s.cancelText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.save, (!canSave || saving) && { opacity: 0.45 }]}
              onPress={handleSave}
              disabled={!canSave || saving}
              accessibilityRole="button"
            >
              <Text style={s.saveText}>{saving ? 'Un instant…' : 'Enregistrer'}</Text>
            </TouchableOpacity>
          </View>

        </Pressable>
      </KeyboardAwareOverlay>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    box: {
      width: '100%', maxWidth: 460, backgroundColor: c.cardSolid,
      borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 12,
    },

    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 17, fontWeight: '800', color: c.text },
    lead: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },

    segment: { flexDirection: 'row', gap: 8 },
    segmentBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 9,
    },
    segmentText: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary, flexShrink: 1 },

    /* Le profil en cours : une ligne à lui, aux couleurs du palier. Assez discret pour ne pas
       disputer la vedette au choix lui-même, assez présent pour répondre à « lequel ? ». */
    profileRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8,
    },
    profileEmoji: { fontSize: 16 },
    profileLabel: { flex: 1, fontSize: 12.5, color: c.textSecondary },
    profileName: { fontWeight: '800' },

    info: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: c.teal + '12', borderRadius: 12, padding: 11,
    },
    infoText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17.5 },

    rows: { gap: 2 },
    rowHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4 },
    rowHeadCell: { fontSize: 10.5, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    refCol: { width: 52, textAlign: 'center' },
    editCol: { width: 124, textAlign: 'center' },

    /* HAUTEUR IDENTIQUE DANS LES DEUX MODES. En manuel la ligne porte un pas de réglage (30 px),
       en automatique une simple valeur : sans plancher, les quatre lignes se tassaient d'une
       dizaine de pixels chacune au changement d'option, et toute la modale sautait sous le
       curseur — au moment précis où l'on compare les deux répartitions. */
    row: {
      flexDirection: 'row', alignItems: 'center', minHeight: 44,
      paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    rowLabelCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    rowLabel: { fontSize: 13.5, fontWeight: '600', color: c.text, flexShrink: 1 },
    refValue: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600' },
    autoValue: { fontSize: 14.5, fontWeight: '800' },

    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    stepBtn: {
      width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    pctInput: {
      width: 48, textAlign: 'center', fontSize: 15, fontWeight: '800',
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 9,
      paddingVertical: 5, paddingHorizontal: 2,
    },

    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    totalText: { fontSize: 12.5, fontWeight: '800' },
    totalFix: { fontSize: 12, fontWeight: '700', color: c.emerald, textDecorationLine: 'underline' },

    /* Bloc « pourquoi mes montants ne suivent pas ces % ». Teinte d'INFORMATION (teal), comme le
       bloc d'explication du mode juste au-dessus : rien n'est en défaut, rien n'est à corriger. */
    except: {
      gap: 8,
      backgroundColor: c.teal + '12', borderRadius: 12, padding: 12,
    },
    exceptHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    exceptTitle: { flex: 1, fontSize: 12.5, fontWeight: '800', color: c.text, lineHeight: 17 },
    exceptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    exceptBullet: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    exceptText: { flex: 1, fontSize: 11.5, color: c.textSecondary, lineHeight: 17 },
    exceptFoot: { fontSize: 11, color: c.textSecondary, lineHeight: 16, fontStyle: 'italic' },
    b: { fontWeight: '800', color: c.text },

    /* Les styles du bloc « pourquoi ça ne s'applique pas tel quel » ont été retirés avec lui :
       il n'y a plus d'étage qui réécrive ces pourcentages, donc plus rien à expliquer. */

    actions: { flexDirection: 'row', gap: 10, marginTop: 2 },
    cancel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    cancelText: { fontSize: 14.5, fontWeight: '700', color: c.textSecondary },
    save: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center' },
    saveText: { fontSize: 14.5, fontWeight: '800', color: c.bg },
  });
}
