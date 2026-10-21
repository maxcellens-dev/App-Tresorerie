/**
 * ScreenHeader — en-tête des écrans secondaires. Dans le Jardin, la barre du haut (toujours
 * visible) porte déjà le retour et le nom de la page : ce composant DÉCLARE ce nom (rangé par
 * chemin, il ne déborde jamais sur une autre page) et ne rend que l'éventuel élément de droite.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Router from 'expo-router';
import { setHeaderTitle } from '../../lib/garden/headerTitle';

export default function ScreenHeader({ title, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  /* ⚠️ Le chemin de CETTE page, figé au montage : usePathname suit la route AFFICHÉE, et une page
     restée montée dessous (pile) réécrivait sinon son titre sur la page du dessus. */
  const current: string = (Router as any).usePathname?.() ?? '';
  const path = useRef(current).current;
  useEffect(() => { if (path) setHeaderTitle(path, title); }, [path, title]);
  return right ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 12 }}>{right}</View> : null;
}
