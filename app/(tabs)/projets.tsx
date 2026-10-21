/**
 * PROJETS — un onglet à part entière (refonte Jardin) : les grandes fonctions à un geste, pas en
 * bas d'une longue page. Il reprend TOUT ce que portait l'onglet « Projets » de l'ancienne page
 * Budget (qui, en mode Jardin, ne montre plus que les budgets) :
 *   - mes projets perso, avec leur avancement ;
 *   - les projets partagés, et les invitations à accepter ou refuser ;
 *   - la création d'un projet perso (écran existant) ou partagé (ici, mêmes champs qu'avant) ;
 *   - les archives.
 * Le détail d'un projet reste l'écran existant (projects/add?id=…, relyka-world/[id]).
 */
import AdSlot from '../../components/marketing/AdSlot';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GardenPage, { GardenGrid, GardenWaiting } from '../../components/garden/GardenPage';
import GardenText from '../../components/garden/GardenText';
import GardenCard from '../../components/garden/GardenCard';
import GardenButton from '../../components/garden/GardenButton';
import GardenBar from '../../components/garden/GardenBar';
import GardenSegmented from '../../components/garden/GardenSegmented';
import GardenSheet from '../../components/garden/GardenSheet';
import PicoBubble from '../../components/garden/PicoBubble';
import GardenIcon from '../../components/garden/GardenIcon';
import { GardenRowGroup } from '../../components/garden/GardenList';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import CurrencyPicker from '../../components/account/CurrencyPicker';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { useProjects } from '../../hooks/data/useProjects';
import { useRwProjects, useRwInvitations, useRwRespondInvitation, useCreateRwProject } from '../../hooks/engagement/useRelykaWorld';
import { usePilotageData } from '../../hooks/pilotage/usePilotageData';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { TABS, WORDS } from '../../lib/garden/lexicon';
import { pointer } from '../../lib/ui/webLayout';

type Tab = 'mine' | 'shared';
const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const MODE_LABEL: Record<string, string> = { transfer: 'mettre de côté', reserve: 'conserver', spend: 'dépenser petit à petit' };
/** Mêmes icônes que l'ancienne création de projet partagé. */
const RW_EMOJIS = ['💸', '🏖️', '✈️', '🍽️', '🎉', '🏠', '🚗', '⛰️', '🛒', '🎲'];

export default function ProjetsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const projectsQuery = useProjects(user?.id);
  const rwQuery = useRwProjects(user?.id);
  const { data: invitations = [] } = useRwInvitations(user?.id);
  const respond = useRwRespondInvitation(user?.id);
  const createRw = useCreateRwProject(user?.id);
  const { data: pilotage } = usePilotageData(user?.id);
  const readOnly = useReadOnlyGuard();
  const lock = useSubmitLock();
  const [tab, setTab] = useState<Tab>('mine');
  const [archives, setArchives] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [rwName, setRwName] = useState('');
  const [rwDesc, setRwDesc] = useState('');
  const [rwEmoji, setRwEmoji] = useState(RW_EMOJIS[0]);
  const [rwCurrency, setRwCurrency] = useState<string>((profile as any)?.currency_code ?? 'EUR');
  const [rwErr, setRwErr] = useState<string | null>(null);
  const go = (r: string) => router.push(r as any);

  const progressById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of (pilotage?.projects_with_progress ?? []) as any[]) m[x.id] = Number(x.progress_percentage) || 0;
    return m;
  }, [pilotage]);
  const allMine = (projectsQuery.data ?? []) as any[];
  const allShared = (rwQuery.data ?? []) as any[];
  const mine = allMine.filter((p) => (archives ? p.status === 'archived' : p.status !== 'archived'));
  const shared = allShared.filter((p) => (archives ? !!p.archived_at : !p.archived_at));

  const createShared = async () => {
    if (!rwName.trim() || readOnly.blocked() || !lock.acquire()) return;
    setRwErr(null);
    try {
      const myName = (profile as any)?.full_name || user?.email?.split('@')[0] || 'Moi';
      const proj = await createRw.mutateAsync({ name: rwName.trim(), emoji: rwEmoji, description: rwDesc.trim(), myName, currency: rwCurrency });
      setCreateOpen(false); setRwName(''); setRwDesc(''); setRwEmoji(RW_EMOJIS[0]);
      go(`/(tabs)/(secondary)/relyka-world/${(proj as any).id}`);
    } catch (e: any) {
      setRwErr(e?.message ?? 'Création impossible.');
    } finally {
      lock.release();
    }
  };

  const answer = (inviteId: string, accept: boolean) => {
    if (readOnly.blocked()) return;
    respond.mutate({ inviteId, accept });
  };

  return (
    <GardenPage calculator="projets" title={TABS.projects} subtitle="Des plantes en pot à côté de ton arbre : chacune fleurit quand l'objectif est atteint."
      footer={<GardenButton label="Nouveau projet" onPress={() => setNewOpen(true)} />}>
      {/* L'ampoule de l'ancienne page : ce qu'est un projet, ses trois modes, ses rythmes, le partagé. */}
      <Pressable onPress={() => setInfoOpen(true)} accessibilityRole="button" accessibilityLabel="À quoi servent les projets ?"
        style={({ pressed }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: GARDEN_RADII.pill, backgroundColor: G.pico, opacity: pressed ? 0.8 : 1 }, pointer]}>
        <Ionicons name="bulb-outline" size={16} color={G.picoText} />
        <GardenText variant="smallStrong" color={G.picoText}>À quoi servent les projets ?</GardenText>
      </Pressable>
      {invitations.length > 0 ? (
        <View style={{ gap: GARDEN_SPACE.sm }}>
          <GardenText variant="label">Invitations</GardenText>
          {invitations.map((inv: any) => (
            <GardenCard key={inv.id} tint={G.waterBg} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
              <GardenText variant="title">{inv.project_emoji ?? '💸'}</GardenText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <GardenText variant="bodyStrong" numberOfLines={1}>{inv.project_name}</GardenText>
                <GardenText variant="small" color={G.inkSoft} numberOfLines={1}>Invitation de {inv.from_name}</GardenText>
              </View>
              <Pressable onPress={() => answer(inv.id, false)} accessibilityRole="button" accessibilityLabel={`Refuser l'invitation à ${inv.project_name}`}
                style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: G.card, alignItems: 'center', justifyContent: 'center' }, pointer]}>
                <Ionicons name="close" size={20} color={G.inkSoft} />
              </Pressable>
              <Pressable onPress={() => answer(inv.id, true)} accessibilityRole="button" accessibilityLabel={`Accepter l'invitation à ${inv.project_name}`}
                style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: G.primary, alignItems: 'center', justifyContent: 'center' }, pointer]}>
                <Ionicons name="checkmark" size={20} color={G.onPrimary} />
              </Pressable>
            </GardenCard>
          ))}
        </View>
      ) : null}

      <GardenSegmented<Tab> accessibilityLabel="Type de projets" items={[{ key: 'mine', label: 'Mes projets' }, { key: 'shared', label: WORDS.sharedProjects }]} value={tab} onChange={setTab} />

      {archives ? <GardenText variant="label">Archives</GardenText> : null}

      {tab === 'mine' ? (
        projectsQuery.isPending ? <GardenWaiting message="Tes projets arrivent…" /> : mine.length === 0 ? (
          <PicoBubble mood="thinking">{archives ? 'Aucun projet archivé.' : 'Pas encore de projet. Un voyage, une voiture, un bébé ? Crée ton premier projet, je calcule combien mettre de côté chaque mois.'}</PicoBubble>
        ) : <GardenGrid cols={3}>{mine.map((p) => {
          const pct = progressById[p.id] ?? 0;
          return (
            <GardenCard key={p.id} onPress={() => go(`/(tabs)/projects/add?id=${p.id}`)} accessibilityLabel={`${p.name}, ${Math.round(pct)} %`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: GARDEN_SPACE.sm }}>
                <GardenText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{p.name}</GardenText>
                <GardenText variant="smallStrong" tabular>{Math.round(pct)} %</GardenText>
              </View>
              <GardenBar value={pct / 100} fill={G.flowers} track={G.flowersBg} accessibilityLabel={`${p.name} : ${Math.round(pct)} %`} />
              <GardenText variant="small" color={G.inkSoft}>
                Objectif {eur(p.target_amount)}{p.monthly_allocation ? ` · ${eur(p.monthly_allocation)}/mois` : ''}{p.target_date ? ` · ${new Date(`${String(p.target_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}` : ''}{p.mode && MODE_LABEL[p.mode] ? ` · ${MODE_LABEL[p.mode]}` : ''}{p.status === 'on_hold' ? ' · en pause' : p.status === 'completed' ? ' · atteint' : ''}
              </GardenText>
            </GardenCard>
          );
        })}</GardenGrid>
      ) : null}

      {tab === 'shared' ? (
        rwQuery.isPending ? <GardenWaiting message="Tes projets partagés arrivent…" /> : shared.length === 0 ? (
          <PicoBubble mood="thinking">{archives ? 'Aucun projet partagé archivé.' : 'Un week-end entre amis, une colocation ? Un projet partagé note qui a payé quoi et qui doit combien.'}</PicoBubble>
        ) : <GardenGrid cols={3}>{shared.map((p) => (
          <GardenCard key={p.id} onPress={() => go(`/(tabs)/(secondary)/relyka-world/${p.id}`)} accessibilityLabel={p.name} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
            <GardenText variant="title">{p.emoji || '💸'}</GardenText>
            <View style={{ flex: 1, minWidth: 0 }}>
              <GardenText variant="bodyStrong" numberOfLines={1}>{p.name}</GardenText>
              {p.description ? <GardenText variant="small" color={G.muted} numberOfLines={1}>{p.description}</GardenText> : null}
            </View>
          </GardenCard>
        ))}</GardenGrid>
      ) : null}

      <GardenButton label={archives ? 'Revenir aux projets en cours' : 'Voir les archives'} variant="secondary" onPress={() => setArchives((v) => !v)} />

      {/* Choix du type de projet */}
      <GardenSheet visible={infoOpen} onClose={() => setInfoOpen(false)} title="À quoi servent les projets ?" subtitle="des plantes en pot, à côté de ton arbre"
        footer={<GardenButton label="J'ai compris" onPress={() => setInfoOpen(false)} />}>
        <GardenText variant="body" color={G.inkSoft}>Un projet, c'est un objectif d'argent (une voiture, un voyage, des cours de piano…) que l'app suit pour toi. Chaque projet est une plante en pot, qui fleurit quand l'objectif est atteint.</GardenText>
        <GardenRowGroup title="Ce que l'app fait pour toi" rows={[
          { key: 'save', label: 'Mettre de côté', sub: 'elle prépare des virements vers ton épargne ou tes placements', icon: GARDEN_ICONS.roots.icon, iconColor: GARDEN_ICONS.roots.fg, iconBg: GARDEN_ICONS.roots.bg },
          { key: 'keep', label: 'Conserver pour plus tard', sub: "l'argent ne bouge pas : il est juste réservé sur ton compte", icon: GARDEN_ICONS.setAside.icon, iconColor: GARDEN_ICONS.setAside.fg, iconBg: GARDEN_ICONS.setAside.bg },
          { key: 'spend', label: 'Dépenser petit à petit', sub: 'elle crée de vraies dépenses au rythme du projet', icon: GARDEN_ICONS.budget.icon, iconColor: GARDEN_ICONS.budget.fg, iconBg: GARDEN_ICONS.budget.bg },
        ]} />
        <GardenText variant="body" color={G.inkSoft}>Puis tu choisis le rythme : un montant chaque mois, une date à atteindre, ou des échéances ponctuelles.</GardenText>
        <GardenCard tint={G.waterBg} style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
          <GardenIcon kind="shared" bg={G.card} />
          <GardenText variant="body" style={{ flex: 1 }}>Un projet partagé suit des dépenses communes (vacances, colocation…) et les équilibre entre plusieurs personnes.</GardenText>
        </GardenCard>
      </GardenSheet>
      <GardenSheet visible={newOpen} onClose={() => setNewOpen(false)} title="Nouveau projet">
        <GardenCard onPress={() => { setNewOpen(false); setTimeout(() => go('/(tabs)/projects/add'), 60); }} accessibilityLabel="Projet perso">
          <GardenText variant="bodyStrong">Projet perso</GardenText>
          <GardenText variant="small" color={G.muted}>Mettre de côté, conserver ou dépenser petit à petit pour un objectif.</GardenText>
        </GardenCard>
        <GardenCard onPress={() => { setNewOpen(false); setTimeout(() => setCreateOpen(true), 250); }} accessibilityLabel="Projet partagé">
          <GardenText variant="bodyStrong">Projet partagé</GardenText>
          <GardenText variant="small" color={G.muted}>Des dépenses à plusieurs, avec « qui doit quoi ».</GardenText>
        </GardenCard>
      </GardenSheet>

      {/* Création d'un projet partagé — mêmes champs que l'ancienne page */}
      <GardenSheet visible={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau projet partagé"
        footer={<GardenButton label="Créer le projet" onPress={createShared} disabled={!rwName.trim()} loading={createRw.isPending} />}>
        <GardenText variant="label">Icône</GardenText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GARDEN_SPACE.sm }}>
          {RW_EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => setRwEmoji(e)} accessibilityRole="button" accessibilityState={{ selected: rwEmoji === e }} accessibilityLabel={`Icône ${e}`}
              style={[{ width: 48, height: 48, borderRadius: GARDEN_RADII.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: G.card, borderWidth: 2, borderColor: rwEmoji === e ? G.primary : G.line }, pointer]}>
              <GardenText variant="title">{e}</GardenText>
            </Pressable>
          ))}
        </View>
        <GardenText variant="label">Nom du projet</GardenText>
        <TextInput value={rwName} onChangeText={setRwName} placeholder="Ex. Week-end à Lyon" placeholderTextColor={G.muted} accessibilityLabel="Nom du projet"
          style={{ minHeight: 48, borderRadius: GARDEN_RADII.sm, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, paddingHorizontal: 14, fontSize: 16, color: G.ink }} />
        <GardenText variant="label">Description (facultatif)</GardenText>
        <TextInput value={rwDesc} onChangeText={setRwDesc} placeholder="Quelques mots…" placeholderTextColor={G.muted} accessibilityLabel="Description du projet"
          style={{ minHeight: 48, borderRadius: GARDEN_RADII.sm, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, paddingHorizontal: 14, fontSize: 16, color: G.ink }} />
        <GardenText variant="label">Devise du projet</GardenText>
        <CurrencyPicker value={rwCurrency} onChange={setRwCurrency} />
        <GardenText variant="small" color={G.inkSoft}>Tous les totaux du projet s'affichent dans cette devise. Elle ne pourra plus changer ensuite.</GardenText>
        {rwErr ? <GardenText variant="small" color={G.fruitsText}>{rwErr}</GardenText> : null}
      </GardenSheet>
      {/* Zone publicité (maison) — bas de page */}
      <AdSlot placement="projets" />
    </GardenPage>
  );
}
