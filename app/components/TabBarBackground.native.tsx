import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

export default function TabBarBackground() {
  return <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />;
}
