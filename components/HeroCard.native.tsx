import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../hooks/useAppColors';


export default function HeroCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return (
    <LinearGradient
      colors={[COLORS.card, COLORS.cardBorder]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}
    >
      {children}
    </LinearGradient>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  card: {},
});
}
