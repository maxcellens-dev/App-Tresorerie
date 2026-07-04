// Route héritée : la page Catégories vit dans (secondary)/categories (version canonique, la plus
// complète — c'est elle que Paramètres et le menu référencent). Ce re-export supprime la seconde
// implémentation divergente du même écran sans casser les anciens liens vers /(tabs)/categories.
export { default } from './(secondary)/categories';
