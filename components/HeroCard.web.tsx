import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
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
  return <View style={[styles.card, style]}>{children}</View>;
}

function makeStyles(c: any) {
  return StyleSheet.create({
  card: { backgroundColor: c.card },
});
}
