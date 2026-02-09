import { StyleSheet, View } from 'react-native';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
});

export default function TabBarBackground() {
  return <View style={styles.root} />;
}
