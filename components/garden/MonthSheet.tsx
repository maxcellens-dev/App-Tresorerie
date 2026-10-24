/**
 * CE MOIS-CI — ce qu'il y a sur tes comptes courants, puis tout le mois (dépensé, encore prévu,
 * réserve, mis de côté, opérations récurrentes, à venir). Ouvert par la jauge de l'accueil et par
 * « Tout voir » d'À venir. Quand un détail s'ouvre, cette feuille s'efface le temps qu'il soit
 * ouvert : une seule fenêtre à la fois (cf. MonthPanel).
 */
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenCard from './GardenCard';
import GardenButton from './GardenButton';
import { useMonthPanel } from './MonthPanel';
import type { PilotageCore } from '../../hooks/garden/usePilotageCore';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { WORDS } from '../../lib/garden/lexicon';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);

interface Props {
  visible: boolean;
  onClose: () => void;
  core: PilotageCore;
  /** Solde des comptes courants (useGardenModel › can). */
  checking: number | null;
  /** Mettre à jour le solde de ses comptes. */
  onUpdateBalances: () => void;
}

export default function MonthSheet({ visible, onClose, core, checking, onUpdateBalances }: Props) {
  if (!visible) return null;
  return <MonthSheetBody onClose={onClose} core={core} checking={checking} onUpdateBalances={onUpdateBalances} />;
}

/* Monté seulement quand la feuille est ouverte : le mois (useMonthPanel) ne se calcule qu'à ce moment. */
function MonthSheetBody({ onClose, core, checking, onUpdateBalances }: Omit<Props, 'visible'>) {
  const month = useMonthPanel(core, onClose);
  return (
    <>
      <GardenSheet visible={!month.subOpen} onClose={onClose} title="Ce mois-ci" subtitle="tes comptes courants et ton mois"
        footer={<GardenButton label={WORDS.gardenTour} onPress={onUpdateBalances} />}>
        {checking != null ? (
          <GardenCard tint={GARDEN_ICONS.water.bg} style={{ gap: 2 }}>
            <GardenText variant="label" color={GARDEN_ICONS.water.fg}>Sur tes comptes courants</GardenText>
            <GardenText variant="amount" tabular>{eur(checking)}</GardenText>
          </GardenCard>
        ) : null}
        {month.content}
      </GardenSheet>
      {month.sheets}
    </>
  );
}
