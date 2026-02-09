import React from 'react';
import { View, StyleSheet } from 'react-native';

const COLORS = { card: '#0f172a' };

export default function HeroCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.card },
});
