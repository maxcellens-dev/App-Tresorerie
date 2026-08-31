/**
 * ALIGNEMENT DES ONGLETS DE PAGE ENTRE ÉCRANS — par MESURE, pas par calcul.
 *
 * ── LE PROBLÈME ────────────────────────────────────────────────────────────────────────────────
 * Deux pages portent des onglets soulignés (« Comptes / Crédits », « Catégories / Historique »),
 * et l'utilisateur passe de l'une à l'autre par la barre du bas. Si elles ne tombent pas à la même
 * hauteur, les onglets sautent à chaque changement d'onglet — c'est très visible.
 *
 * Or ce qui les précède n'a rien de comparable : la page Comptes a une vue d'ensemble (filtre,
 * cartes de totaux, total), la page Budget a un sélecteur de période. Pire, ces blocs n'ont même
 * pas une hauteur FIXE : les cartes de totaux passent de trois à quatre selon les types de comptes
 * possédés, les pastilles de filtre disparaissent s'il n'y a aucun compte partagé, et le sélecteur
 * de période gagne une ligne quand il affiche « Appuyer pour revenir ».
 *
 * ── POURQUOI CALCULER NE MARCHE PAS ────────────────────────────────────────────────────────────
 * Toute marge codée en dur (« la vue d'ensemble fait 151, donc j'ajoute 45 ») n'est juste que pour
 * UNE configuration. Elle redevient fausse dès qu'un utilisateur ouvre un compte d'un type de plus
 * ou accepte un compte partagé. C'est un réglage qui a l'air de marcher chez son auteur.
 *
 * ── LA MÉTHODE ─────────────────────────────────────────────────────────────────────────────────
 * Chaque page MESURE ce qu'elle place au-dessus de ses onglets (`onLayout`) et le publie ici. Le
 * module retient le MAXIMUM observé, et rend à chaque page le complément dont elle a besoin pour
 * atteindre ce maximum. Les onglets tombent alors exactement au même endroit, quelles que soient
 * les données — et le jour où un bloc change de taille, l'accord se refait tout seul.
 *
 * ── CE QUE ÇA N'EST PAS ────────────────────────────────────────────────────────────────────────
 * Ce n'est pas un état applicatif : rien ici n'est persisté ni synchronisé au serveur. C'est une
 * mémoire de MISE EN PAGE, valable le temps de la session. Au tout premier affichage, une page qui
 * n'a jamais vu sa voisine n'a rien à quoi se comparer : elle part de `DEFAULT_TOP`, puis se cale
 * dès que l'autre a été rendue une fois. C'est la seule imprécision qui subsiste, et elle se
 * corrige d'elle-même.
 */
import { useEffect, useState } from 'react';

/**
 * Repère de départ, en points : la hauteur observée du bloc le plus haut (la vue d'ensemble des
 * comptes) dans sa configuration courante. Il ne sert QUE tant qu'aucune page n'a encore été
 * mesurée — après quoi les valeurs réelles prennent le relais.
 */
const DEFAULT_TOP = 150;

const heights = new Map<string, number>();
const listeners = new Set<() => void>();

/** Le plus haut bloc « avant onglets » observé depuis le démarrage. */
function currentMax(): number {
  let max = DEFAULT_TOP;
  for (const h of heights.values()) if (h > max) max = h;
  return max;
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* un écouteur ne doit jamais casser une mise en page */ }
  }
}

/**
 * Publie la hauteur mesurée du bloc précédant les onglets d'une page.
 * `key` identifie la page (une par écran).
 */
export function reportTabsTop(key: string, height: number): void {
  const rounded = Math.round(height);
  if (heights.get(key) === rounded) return;
  const before = currentMax();
  heights.set(key, rounded);
  // On ne réveille les écrans que si le PLAFOND a bougé : c'est lui seul qui décide des marges.
  if (currentMax() !== before) notify();
}

/**
 * Le complément à ajouter AU-DESSUS des onglets de cette page pour qu'ils tombent à la même
 * hauteur que ceux des autres. Vaut 0 pour la page qui porte déjà le bloc le plus haut.
 */
export function useAlignedTabsTop(key: string, ownHeight: number | null): number {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    if (ownHeight != null) reportTabsTop(key, ownHeight);
  }, [key, ownHeight]);

  if (ownHeight == null) return 0;
  return Math.max(0, currentMax() - Math.round(ownHeight));
}

/** Tests : repartir d'une mémoire vide. */
export function resetTabsAlign(): void {
  heights.clear();
  notify();
}
