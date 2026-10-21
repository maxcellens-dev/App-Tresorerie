/**
 * Les choix de Pico du mois — la modale ouverte par « Mes gestes du mois ».
 *
 * Relyka ne déplace pas d'argent : il conseille un virement, l'utilisateur le fait dans sa banque,
 * puis l'ENREGISTRE ici. Chaque bouton passe par une action qui existe déjà :
 *   - « J'ai fait le virement » → l'écran de saisie unique, pré-rempli (même URL que le Pilotage) ;
 *   - « Plus tard » → la pré-épargne / le pré-invest (cumul « En attente ») ;
 *   - « Changer les choix » → la modale de répartition existante (RecoModeModal) ;
 *   - « En attente » → le virement du cumul, qui le remet à zéro (comme la modale des cumuls).
 */
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenIcon from './GardenIcon';
import GardenCard from './GardenCard';
import GardenButton from './GardenButton';
import PicoBubble from './PicoBubble';
import RecoModeModal from '../pilotage/RecoModeModal';
import { useAddPreSavingEntry } from '../../hooks/data/usePreSavings';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { useAuth } from '../../contexts/AuthContext';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { formatEuros, permanentTransferHint, type PicoChoice } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';
import { CHOICE_LOOKS } from '../../lib/garden/choiceLooks';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  onClose: () => void;
  core: PilotageCore;
  choices: PicoChoice[];
}

const monthYear = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function PicoChoicesSheet({ visible, onClose, core, choices }: Props) {
  const router = useRouter();
  const { isImpersonating } = useAuth();
  const addPreSaving = useAddPreSavingEntry(core.userId);
  const lock = useSubmitLock();
  const [modeOpen, setModeOpen] = useState(false);
  const [doneLater, setDoneLater] = useState<Record<string, boolean>>({});
  const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
  const pendingSave = core.vm.preEpargneTotal ?? 0;
  const pendingInvest = core.vm.preInvestTotal ?? 0;

  const goTransfer = (c: PicoChoice) => {
    const dest = c.type === 'invest' ? 'investment' : 'savings';
    const label = `${c.type === 'invest' ? 'Investissement' : 'Épargne'} ${monthYear()}`;
    onClose();
    setTimeout(() => router.push(core.buildTransferUrl({ dest, amount: c.amount, label }) as any), 60);
  };

  const later = async (c: PicoChoice) => {
    if (isImpersonating) { Alert.alert('Consultation seule', "Tu consultes le compte de quelqu'un d'autre : rien n'est enregistré."); return; }
    if (!lock.acquire()) return;
    try {
      await addPreSaving.mutateAsync({ type: c.type === 'invest' ? 'invest' : 'epargne', montant: c.amount });
      setDoneLater((d) => ({ ...d, [c.type]: true }));
    } catch (e) {
      Alert.alert('Un souci', e instanceof Error ? e.message : "La mise de côté n'a pas pu être enregistrée.");
    } finally {
      lock.release();
    }
  };

  const transferPending = (type: 'epargne' | 'invest', amount: number) => {
    onClose();
    const dest = type === 'invest' ? 'investment' : 'savings';
    const label = `${type === 'invest' ? 'Investissement' : 'Épargne'} ${monthYear()} (cumul)`;
    setTimeout(() => router.push(core.buildTransferUrl({ dest, amount, label, resetPreSaving: type }) as any), 60);
  };

  return (
    <>
      <GardenSheet
        visible={visible && !modeOpen}
        onClose={onClose}
        title={WORDS.picoChoices}
        subtitle="L'eau de ton arrosoir, utilisée au mieux. Fais les virements dans ta banque, puis enregistre-les ici."
        footer={<GardenButton label={WORDS.changeChoices} variant="secondary" onPress={() => setModeOpen(true)} />}
      >
        {choices.length === 0 ? <PicoBubble mood="thinking">Pas de choix ce mois-ci : ton Relyka est déjà réparti.</PicoBubble> : null}
        {choices.map((c) => {
          const hint = permanentTransferHint(c, CURRENCY_SYMBOL);
          return (
            <GardenCard key={c.type} style={{ gap: GARDEN_SPACE.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
                <GardenIcon icon={CHOICE_LOOKS[c.type].icon} fg={CHOICE_LOOKS[c.type].fg} bg={CHOICE_LOOKS[c.type].bg} />
                <View style={{ flex: 1 }}>
                  <GardenText variant="heading">{CHOICE_LOOKS[c.type].verb}</GardenText>
                  <GardenText variant="small" color={GARDEN_COLORS.muted}>{CHOICE_LOOKS[c.type].meaning}</GardenText>
                </View>
                <GardenText variant="heading" tabular color={CHOICE_LOOKS[c.type].fg}>{eur(c.amount)}</GardenText>
              </View>
              <GardenText variant="body" color={GARDEN_COLORS.inkSoft}>{c.text}</GardenText>
              {hint ? <GardenText variant="small" color={GARDEN_COLORS.inkSoft}>{hint}</GardenText> : null}
              {c.kind === 'transfer' ? (
                doneLater[c.type] ? (
                  <GardenText variant="smallStrong" color={GARDEN_COLORS.noticeText}>Mis de côté pour plus tard · {eur(c.amount)} {WORDS.pending.toLowerCase()}</GardenText>
                ) : (
                  <View style={{ gap: GARDEN_SPACE.sm }}>
                    <GardenButton label={WORDS.transferDone} onPress={() => goTransfer(c)} />
                    <GardenButton label={`${WORDS.later} · mettre de côté`} variant="secondary" loading={addPreSaving.isPending} onPress={() => later(c)} />
                  </View>
                )
              ) : null}
            </GardenCard>
          );
        })}
        {pendingSave > 0 || pendingInvest > 0 ? (
          <GardenCard tint={GARDEN_COLORS.notice} style={{ gap: GARDEN_SPACE.sm }}>
            <GardenText variant="label" color={GARDEN_COLORS.noticeText}>{WORDS.pending}</GardenText>
            {pendingSave > 0 ? (
              <View style={{ gap: 6 }}>
                <GardenText variant="body">{eur(pendingSave)} pour tes racines, mis de côté pour plus tard.</GardenText>
                <GardenButton label="Faire ce virement maintenant" variant="secondary" onPress={() => transferPending('epargne', pendingSave)} />
              </View>
            ) : null}
            {pendingInvest > 0 ? (
              <View style={{ gap: 6 }}>
                <GardenText variant="body">{eur(pendingInvest)} pour tes fruits (placements), mis de côté pour plus tard.</GardenText>
                <GardenButton label="Faire ce virement maintenant" variant="secondary" onPress={() => transferPending('invest', pendingInvest)} />
              </View>
            ) : null}
          </GardenCard>
        ) : null}
      </GardenSheet>
      <RecoModeModal visible={modeOpen} onClose={() => setModeOpen(false)} userId={core.userId} />
    </>
  );
}
