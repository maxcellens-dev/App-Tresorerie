/**
 * « Argent mis de côté » (Mon argent › Ce mois) : le détail du montant, ET les gestes qui le
 * modifient — ceux de l'ancienne modale « Montants réservés » du Pilotage, que la refonte Jardin
 * n'avait pas repris :
 *   - GARDÉ CE MOIS-CI dans l'arrosoir (réservation du mois) → modifier le montant (0 = tout
 *     libérer), ou « Libérer » d'un geste ;
 *   - MIS DE CÔTÉ POUR PLUS TARD (cumuls de pré-épargne / pré-invest) → ajouter un montant, faire le
 *     virement global (saisie pré-remplie qui remet le cumul à zéro), ou remettre à zéro. Ces deux
 *     lignes restent affichées MÊME À ZÉRO : c'est par elles qu'on met un premier montant de côté ;
 *   - RÉSERVÉ POUR TES PROJETS → faire le virement (qui libère la réserve), ou libérer.
 *
 * Une seule feuille : la saisie remplace la liste (bouton « Retour »), on n'empile pas de fenêtres.
 */
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenButton from './GardenButton';
import { GardenRowGroup } from './GardenList';
import { AmountField, useWriteGuard } from './MonthSettingsSheets';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { useSetMonthlyReservation } from '../../hooks/data/useReservations';
import { useAddPreSavingEntry, useResetPreSaving } from '../../hooks/data/usePreSavings';
import { useReleaseReservedByProject } from '../../hooks/data/useTransactions';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../lib/garden/theme';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const parse = (s: string) => Math.max(0, parseFloat(String(s).replace(',', '.')) || 0);
const monthYear = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

type Mode = 'list' | 'kept' | 'epargne' | 'invest';

export default function SetAsideSheet({ visible, onClose, core }: { visible: boolean; onClose: () => void; core: PilotageCore }) {
  const router = useRouter();
  const blocked = useWriteGuard();
  const lock = useSubmitLock();
  const setMonthly = useSetMonthlyReservation(core.userId);
  const addPreSaving = useAddPreSavingEntry(core.userId);
  const resetPreSaving = useResetPreSaving(core.userId);
  const releaseProject = useReleaseReservedByProject(core.userId);
  const [mode, setMode] = useState<Mode>('list');
  const [draft, setDraft] = useState('');
  useEffect(() => { if (visible) setMode('list'); }, [visible]);

  const p = core.pilotageData;
  const projects = (p?.reserved_by_project ?? []).filter((r) => r.total > 0);
  const kept = Math.max(0, core.vm.reservationsTotal ?? 0);
  const pending = { epargne: Math.max(0, core.vm.preEpargneTotal ?? 0), invest: Math.max(0, core.vm.preInvestTotal ?? 0) };
  const total = projects.reduce((s, r) => s + r.total, 0) + kept + pending.epargne + pending.invest;

  const fail = (what: string) => (e: any) => Alert.alert('Un souci', e?.message ?? `${what} n'a pas pu être enregistré.`);
  const go = (url: string) => { onClose(); setTimeout(() => router.push(url as any), 60); };
  const open = (m: Exclude<Mode, 'list'>) => { setDraft(m === 'kept' && kept > 0 ? String(Math.round(kept)) : ''); setMode(m); };

  /* ── Gardé ce mois-ci : on pose un TOTAL (0 = tout libérer) ── */
  const saveKept = (montant: number) => {
    if (blocked()) return;
    setMonthly.mutate({ montant: Math.round(montant), libelle: `Réservé ${monthYear()}` }, { onError: fail('Le montant gardé') });
    setMode('list');
  };

  /* ── Mis de côté pour plus tard : on AJOUTE (non idempotent → verrou), virement global, remise à 0 ── */
  const addPending = (type: 'epargne' | 'invest') => {
    const montant = parse(draft);
    if (montant <= 0 || blocked() || !lock.acquire()) return;
    addPreSaving.mutate({ type, montant }, { onError: fail('Ce montant mis de côté'), onSettled: () => lock.release() });
    setMode('list');
  };
  const transferPending = (type: 'epargne' | 'invest', amount: number) => go(core.buildTransferUrl({
    dest: type === 'invest' ? 'investment' : 'savings', amount,
    label: `${type === 'invest' ? 'Investissement' : 'Épargne'} ${monthYear()} (cumul)`, resetPreSaving: type,
  }));
  const resetPending = (type: 'epargne' | 'invest') => Alert.alert('Remettre à 0', 'Remettre ce montant à 0 ? Aucun virement ne sera créé.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Remettre à 0', style: 'destructive', onPress: () => { if (blocked()) return; resetPreSaving.mutate(type, { onError: fail('La remise à zéro') }); setMode('list'); } },
  ]);

  /* ── Réservé pour un projet : virement (qui libère la réserve) ou libération ── */
  const transferProject = (r: (typeof projects)[number]) => go(`/(tabs)/transactions/add?${new URLSearchParams({
    type: 'transfer', account: r.source_account_id ?? '', to: r.linked_account_id ?? '', amount: String(Math.round(r.total)),
    label: r.name, origin: '/(tabs)/argent', releaseProject: r.id,
  }).toString()}`);
  const releaseProj = (r: (typeof projects)[number]) => Alert.alert('Libérer', `Libérer les ${eur(r.total)} réservés pour « ${r.name} » ? Ils redeviennent disponibles.`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Libérer', style: 'destructive', onPress: () => { if (blocked()) return; releaseProject.mutate(r.id, { onError: fail('La libération de ce projet') }); } },
  ]);

  /* ── Saisie (remplace la liste) ── */
  if (mode !== 'list') {
    const isKept = mode === 'kept';
    const t = mode === 'kept' ? null : mode;
    const after = t ? pending[t] + parse(draft) : parse(draft);
    const title = isKept ? "Gardé dans l'arrosoir" : t === 'epargne' ? 'Pour tes racines' : 'Pour tes fruits';
    return (
      <GardenSheet visible={visible} onClose={onClose} title={title}
        subtitle={isKept ? 'le montant que tu gardes ce mois-ci sur ton compte courant' : `à virer plus tard vers ${t === 'epargne' ? 'ton épargne' : 'tes placements'}`}
        footer={(
          <View style={{ gap: GARDEN_SPACE.sm }}>
            {isKept
              ? <GardenButton label="Enregistrer" onPress={() => saveKept(parse(draft))} />
              : <GardenButton label={`Ajouter ${parse(draft) > 0 ? eur(parse(draft)) : ''}`.trim()} disabled={parse(draft) <= 0} onPress={() => addPending(t!)} />}
            {t && after > 0 ? <GardenButton label={`Faire le virement global (${eur(after)})`} variant="secondary" onPress={() => transferPending(t, after)} /> : null}
            <GardenButton label="Retour" variant="secondary" onPress={() => setMode('list')} />
          </View>
        )}>
        <GardenText variant="label">{isKept ? 'Montant gardé ce mois-ci' : 'Montant à ajouter'}</GardenText>
        <AmountField value={draft} onChange={setDraft} unit={CURRENCY_SYMBOL} />
        <GardenText variant="body" color={G.inkSoft}>
          {isKept
            ? "Ce montant reste sur ton compte, mais ne compte plus dans ce qu'il te reste à utiliser. Mets 0 pour tout libérer. Il repart de zéro chaque mois."
            : `Déjà mis de côté : ${eur(pending[t!])}. Après ajout : ${eur(after)}. Il ne compte plus dans ce qu'il te reste à utiliser tant que tu n'as pas fait le virement.`}
        </GardenText>
        {t && pending[t] > 0 ? <GardenButton label="Remettre à 0" variant="secondary" onPress={() => resetPending(t)} /> : null}
      </GardenSheet>
    );
  }

  /* ── Liste ── */
  return (
    <GardenSheet visible={visible} onClose={onClose} title="Argent mis de côté" subtitle={`${eur(total)} qui ne comptent pas dans ce qu'il te reste à utiliser`}>
      <View style={{ gap: 6 }}>
        <GardenRowGroup title="Gardé ce mois-ci" rows={[{
          key: 'kept', label: "Dans l'arrosoir", value: eur(kept), onPress: () => open('kept'),
          sub: kept > 0 ? 'repart de zéro chaque mois · touche pour modifier' : 'touche pour garder un montant',
          icon: GARDEN_ICONS.water.icon, iconColor: GARDEN_ICONS.water.fg, iconBg: GARDEN_ICONS.water.bg,
        }]} />
        {kept > 0 ? <GardenButton label="Libérer" variant="secondary" onPress={() => saveKept(0)} /> : null}
      </View>

      {/* Toujours affichés, même à 0 : c'est par eux qu'on met un premier montant de côté. */}
      <GardenRowGroup title="Mis de côté pour plus tard" rows={([['epargne', 'Pour tes racines', 'épargne', 'roots'], ['invest', 'Pour tes fruits', 'placements', 'fruits']] as const).map(([type, label, what, kind]) => ({
        key: type, label, value: eur(pending[type]), onPress: () => open(type),
        sub: pending[type] > 0 ? `${what} · en attente de virement` : `${what} · touche pour ajouter un montant`,
        icon: GARDEN_ICONS[kind].icon, iconColor: GARDEN_ICONS[kind].fg, iconBg: GARDEN_ICONS[kind].bg,
      }))} />

      {projects.length ? (
        <View style={{ gap: GARDEN_SPACE.sm }}>
          <GardenText variant="label" style={{ paddingHorizontal: 4 }}>Réservé pour tes projets</GardenText>
          {projects.map((r) => (
            <View key={r.id} style={{ gap: 6 }}>
              <GardenRowGroup rows={[{
                key: r.id, label: r.name, sub: 'réservé sur ton compte', value: eur(r.total), onPress: () => go('/(tabs)/projets'),
                icon: GARDEN_ICONS.setAside.icon, iconColor: GARDEN_ICONS.setAside.fg, iconBg: GARDEN_ICONS.setAside.bg,
              }]} />
              <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm }}>
                {r.linked_account_id ? <View style={{ flex: 1 }}><GardenButton label="Faire le virement" variant="secondary" onPress={() => transferProject(r)} /></View> : null}
                <View style={{ flex: 1 }}><GardenButton label="Libérer" variant="secondary" onPress={() => releaseProj(r)} /></View>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </GardenSheet>
  );
}
