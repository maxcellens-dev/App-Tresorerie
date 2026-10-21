/**
 * ScreenGradient — fond des écrans : celui du Jardin (uni en clair, halo d'accent en sombre).
 * À placer juste après <StatusBar/> dans chaque écran. Gardé comme point d'entrée unique pour que
 * les écrans n'aient pas à connaître GardenGlow.
 */
import GardenGlow from '../garden/GardenGlow';

export default function ScreenGradient() {
  return <GardenGlow />;
}
