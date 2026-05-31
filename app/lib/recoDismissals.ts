/**
 * Gestion locale (par mois) des recommandations masquées.
 *
 * Deux notions distinctes :
 *  • `ignored`   — l'utilisateur a cliqué « Ignorer ». On mémorise le MONTANT au
 *                  moment de l'ignore. La reco reste masquée tant que le montant
 *                  recalculé est identique ; si la situation change (montant
 *                  différent), elle réapparaît.
 *  • `completed` — l'utilisateur a agi (virement validé / réservation confirmée).
 *                  La reco est masquée jusqu'au mois suivant.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecoType } from './recommendationEngine';

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const ignoredKey = () => `reco_ignored_${monthKey()}`;
const completedKey = () => `reco_completed_${monthKey()}`;

export type IgnoredMap = Partial<Record<RecoType, number>>;

export async function getIgnored(): Promise<IgnoredMap> {
  try {
    const raw = await AsyncStorage.getItem(ignoredKey());
    return raw ? (JSON.parse(raw) as IgnoredMap) : {};
  } catch {
    return {};
  }
}

export async function addIgnored(type: RecoType, amount: number): Promise<void> {
  try {
    const map = await getIgnored();
    map[type] = Math.round(amount);
    await AsyncStorage.setItem(ignoredKey(), JSON.stringify(map));
  } catch {
    /* noop */
  }
}

export async function getCompleted(): Promise<RecoType[]> {
  try {
    const raw = await AsyncStorage.getItem(completedKey());
    return raw ? (JSON.parse(raw) as RecoType[]) : [];
  } catch {
    return [];
  }
}

export async function addCompleted(type: RecoType): Promise<void> {
  try {
    const list = await getCompleted();
    if (!list.includes(type)) {
      list.push(type);
      await AsyncStorage.setItem(completedKey(), JSON.stringify(list));
    }
  } catch {
    /* noop */
  }
}

/** Une reco est masquée si « complétée », ou « ignorée » avec le même montant. */
export function isHidden(type: RecoType, amount: number, ignored: IgnoredMap, completed: RecoType[]): boolean {
  if (completed.includes(type)) return true;
  const ignoredAmount = ignored[type];
  return ignoredAmount !== undefined && ignoredAmount === Math.round(amount);
}
