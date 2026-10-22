/**
 * Les mots de l'accueil quand le Relyka est à 0, en mots courants. Même règle de tons que le moteur
 * (lib/finance/pilotageView › relykaTone) : seuls les MOTS changent, pas le calcul. Le Pilotage
 * garde ses propres phrases (relykaZeroHero).
 *
 * Ton : jamais de drame. Un mois serré repart à la prochaine rentrée, on le dit quand on la connaît.
 */
import { relykaTone, type RelykaBreakdown } from '../finance/pilotageView';

type Input = Pick<RelykaBreakdown, 'resteDisponibleBrut'> & Partial<RelykaBreakdown>;

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** `null` quand il reste de l'argent libre (le montant s'affiche alors normalement). */
export function gardenRelykaZero(b: Input): { word: string; sub: string } | null {
  const tone = relykaTone(b);
  if (tone === 'positive') return null;
  const refill = b.nextIncomeDate ? ` avec ta rentrée du ${day(b.nextIncomeDate)}` : ' avec ta prochaine rentrée';
  if (tone === 'allocated') return {
    word: 'Tout est déjà mis de côté',
    sub: `Tu as mis ${eur(b.conservedTotal ?? 0)} de côté ce mois-ci, pour tes projets et ta réserve.`,
  };
  if (tone === 'negative') return {
    word: 'Mois serré',
    sub: `Tu as utilisé ta réserve ce mois-ci, et ${eur(Math.abs(b.resteDisponibleBrut))} de plus. Ça repart${refill}.`,
  };
  return {
    word: 'Rien de libre ce mois-ci',
    sub: `Tout ton argent est déjà prévu pour tes dépenses. Ça repart${refill}.`,
  };
}
