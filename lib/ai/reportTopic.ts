/**
 * De quoi parle un bloc d'une réponse de Pépin (titre de section, signal, action) → la partie de
 * l'arbre qui l'illustre (lib/garden/icons). On illustre, on ne renomme pas : le titre de l'IA
 * reste affiché tel quel, en mots simples ; seule l'image vient du Jardin. Fonction PURE.
 *
 * L'ordre compte : le premier sujet reconnu gagne (« crédit » avant « dépense » dans « dépenses de
 * crédit »). Rien de reconnu → le conseil (ampoule).
 */
import type { GardenIconKey } from '../garden/icons';

const RULES: [RegExp, GardenIconKey][] = [
  [/cr[ée]dit|dette|emprunt|pr[êe]t|mensualit|d[ée]couvert|rembours/, 'brambles'],
  [/placement|invest|bourse|pea|assurance.?vie|etf|rendement|plus.?value|patrimoine/, 'fruits'],
  [/[ée]pargne|matelas|s[ée]curit[ée]|secours|pr[ée]caution|r[ée]serve|livret/, 'roots'],
  [/projet|objectif/, 'setAside'],
  [/plaisir|loisir|confort|envie|sortie/, 'flowers'],
  [/abonnement|r[ée]current|pr[ée]l[èe]vement|charge.? fixe/, 'recurring'],
  [/d[ée]pense|budget|courses|quotidien|cat[ée]gor/, 'budget'],
  [/tr[ée]sorerie|solde|compte courant|fin de mois|liquidit|revenu|salaire|rentr[ée]e/, 'water'],
  [/vigilance|risque|alerte|attention|danger|surveiller/, 'warn'],
  [/bravo|force|point fort|bien|r[ée]ussi/, 'done'],
  [/action|conseil|recommand|prochaine|[ée]tape|plan/, 'tip'],
];

export function reportTopic(text: string): GardenIconKey {
  const t = String(text ?? '').toLowerCase();
  for (const [re, key] of RULES) if (re.test(t)) return key;
  return 'tip';
}
