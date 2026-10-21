/**
 * Les mots du Jardin quand le Relyka est à 0 — dans le langage de l'ARROSOIR (le Relyka, c'est l'eau
 * de l'arrosoir). Même règle de tons que le moteur (lib/finance/pilotageView › relykaTone) : seuls les
 * MOTS changent, pas le calcul. Le Pilotage garde ses propres phrases (relykaZeroHero).
 *
 * Ton du Jardin : jamais de drame. Un mois serré, c'est un arrosoir moins plein, qui se remplira à la
 * prochaine rentrée — on le dit quand on la connaît.
 */
import { relykaTone, type RelykaBreakdown } from '../finance/pilotageView';

type Input = Pick<RelykaBreakdown, 'resteDisponibleBrut'> & Partial<RelykaBreakdown>;

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** `null` quand il reste de l'eau (le montant s'affiche alors normalement). */
export function gardenRelykaZero(b: Input): { word: string; sub: string } | null {
  const tone = relykaTone(b);
  if (tone === 'positive') return null;
  const refill = b.nextIncomeDate ? ` avec ta rentrée du ${day(b.nextIncomeDate)}` : ' avec ta prochaine rentrée';
  if (tone === 'allocated') return {
    word: 'Toute ton eau est déjà versée',
    sub: `Tu as mis ${eur(b.conservedTotal ?? 0)} de côté ce mois-ci : ils arrosent tes projets et tes réserves.`,
  };
  if (tone === 'negative') return {
    word: 'Ton arrosoir est à sec',
    sub: `Tu as utilisé toutes tes réserves ce mois-ci, et ${eur(Math.abs(b.resteDisponibleBrut))} de plus. Il se remplira${refill}.`,
  };
  return {
    word: 'Ton arrosoir est vide',
    sub: `Toute ton eau est déjà promise à tes dépenses prévues. Il se remplira${refill}.`,
  };
}
