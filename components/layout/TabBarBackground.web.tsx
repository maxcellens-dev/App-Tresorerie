import { StyleSheet, View } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';

export default function TabBarBackground() {
  const c = useAppColors();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: c.card }]} />;
}
