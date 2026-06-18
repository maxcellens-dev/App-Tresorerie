// Déclaration de types pour le composant à variantes de plateforme
// (TabBarBackground.native.tsx / TabBarBackground.web.tsx).
// Metro choisit la bonne variante au runtime ; TypeScript utilise cette déclaration.
declare const TabBarBackground: () => JSX.Element;
export default TabBarBackground;
