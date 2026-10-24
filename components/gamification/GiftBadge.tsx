/**
 * Le CADEAU DU JOUR à réclamer, dans l'en-tête : une pièce Relyk qui sautille toute seule. Elle
 * ouvre la boutique, où le cadeau attend en tête ; une fois réclamé, elle disparaît de l'en-tête.
 * Animation native (useNativeDriver), arrêtée au démontage.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import CurrencyIcon from './CurrencyIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useGamification } from '../../hooks/engagement/useGamification';
import { pointer } from '../../lib/ui/webLayout';

export default function GiftBadge({ size = 30 }: { size?: number }) {
  const router = useRouter();
  const { user } = useAuth();
  const { canClaimDailyGems, isReady, config } = useGamification(user?.id);
  // Pas de cadeau dans le catalogue (retiré en admin) → rien à signaler.
  const hasGift = !!config?.shop?.some((s) => s.type === 'daily_gems');
  const visible = isReady && canClaimDailyGems && hasGift;
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 420, easing: Easing.bounce, useNativeDriver: true }),
      Animated.delay(1400),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible, t]);

  if (!visible) return null;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-12deg'] });
  return (
    <Pressable onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} accessibilityRole="button" accessibilityLabel="Ton cadeau du jour t'attend : ouvrir la boutique" hitSlop={8} style={pointer}>
      <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>
        <CurrencyIcon size={size} />
      </Animated.View>
    </Pressable>
  );
}
