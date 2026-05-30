import { StyleSheet, View } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';

export default function TabBarBackground() {
  const c = useAppColors();
  return <View style={[StyleSheet.absoluteFillObject, { backgroundColor: c.card }]} />;
}
