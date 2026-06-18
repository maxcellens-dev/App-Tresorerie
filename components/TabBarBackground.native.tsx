import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useAppColors } from '../hooks/useAppColors';

export default function TabBarBackground() {
  const c = useAppColors();
  const tint = c.bg === '#020617' ? 'dark' : 'light';
  return <BlurView intensity={80} tint={tint} style={StyleSheet.absoluteFill} />;
}
