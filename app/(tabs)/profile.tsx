// Route héritée : la page Profil vit dans (secondary)/profile (version canonique, la plus complète —
// c'est elle que le menu profil référence). Ce re-export supprime la seconde implémentation
// divergente du même écran sans casser les anciens liens vers /(tabs)/profile (ex. LegalScreen).
export { default } from './(secondary)/profile';
