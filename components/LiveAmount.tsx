/**
 * LiveAmount — un chiffre qui DIT qu'il est en train d'être recalculé.
 *
 * Le tableau de bord est patché dès la saisie (cf. lib/pilotagePatch) : dans le cas courant, le
 * Relyka est juste immédiatement. Mais tous les chemins ne sont pas devinables — opération datée
 * dans le futur, virement, échéance de crédit, rattachement à un projet, démarrage à froid — et
 * là, le chiffre affiché est encore l'ANCIEN pendant que le serveur recalcule.
 *
 * Afficher une valeur périmée avec l'aplomb d'une valeur définitive, puis la voir sauter, c'est ce
 * qui fait douter de l'app. On ne cache donc rien derrière un voile : on marque le chiffre. Une
 * respiration lente de l'opacité, le temps du recalcul — assez visible pour dire « ce n'est pas
 * encore figé », assez discrète pour ne pas rivaliser avec la valeur elle-même.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, type ViewStyle, type StyleProp } from 'react-native';
import { useIsFetching } from '@tanstack/react-query';

/** Requêtes dont dépendent les chiffres du tableau de bord (mêmes clés que le Pouls). */
const DASHBOARD_QUERIES = new Set(['pilotage_data', 'accounts', 'transactions']);

/** Le tableau de bord est-il en cours de recalcul ? */
export function useDashboardRecomputing(): boolean {
  return useIsFetching({ predicate: (q) => DASHBOARD_QUERIES.has(String(q.queryKey[0])) }) > 0;
}

export default function LiveAmount({ children, style }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const recomputing = useDashboardRecomputing();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!recomputing) {
      // Retour à l'opaque : franc, pas au milieu d'une respiration (sinon le chiffre « atterrit »
      // à une opacité arbitraire au moment précis où il devient définitif).
      Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 520, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recomputing, pulse]);

  return <Animated.View style={[style, { opacity: pulse }]}>{children}</Animated.View>;
}
