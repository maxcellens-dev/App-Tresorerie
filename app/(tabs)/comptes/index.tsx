/**
 * Ancienne page Comptes : la vue d'ensemble des comptes est désormais « Mon argent ».
 * Les fiches (/comptes/[id]), l'ajout et la mise à jour des soldes restent sous /comptes.
 */
import { Redirect } from 'expo-router';

export default function ComptesIndexRoute() {
  return <Redirect href="/(tabs)/argent" />;
}
