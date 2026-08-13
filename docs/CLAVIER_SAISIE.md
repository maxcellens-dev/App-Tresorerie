# Clavier & saisie — règle unique

## Le problème

Depuis `targetSdk ≥ 35` (edge-to-edge), **la fenêtre Android n'est jamais redimensionnée** à
l'ouverture du clavier : `android:windowSoftInputMode=adjustResize` est ignoré, et
`KeyboardAvoidingView` (RN) ne décale rien de fiable — son calcul repose sur un `onLayout` relatif au
parent, faux dès que le contenu ne part pas du haut de la fenêtre.

Résultat visible : le clavier recouvre le bas de l'écran, **les derniers champs et les boutons de
validation deviennent inatteignables** (cas typique : la modale « Supprimer définitivement », dont le
champ de confirmation et le bouton passaient sous le clavier, sans possibilité de scroller).

## La règle

On **mesure** le chevauchement et on l'applique soi-même. Trois briques, une seule source :

| Brique | Fichier | À utiliser quand |
| --- | --- | --- |
| `useKeyboardHeight()` | `hooks/platform/useKeyboardHeight.ts` | On a besoin de la hauteur brute (0 = fermé). Gère iOS (`will*`), Android (`did*`) et le web (`visualViewport`). |
| `<KeyboardAwareScrollView>` | `components/layout/KeyboardAwareScrollView.tsx` | **Écran** avec des champs → remplace `<ScrollView>`, rien d'autre à changer. |
| `<KeyboardAwareOverlay>` | `components/layout/KeyboardAwareOverlay.tsx` | **Modale** avec des champs → remplace le `<View>`/`<Pressable>` d'overlay. |

Les deux composants font la même chose :

1. **La zone utile s'arrête au-dessus du clavier** → une modale centrée se recentre au-dessus de lui,
   une feuille du bas remonte d'autant.
2. **On gagne la hauteur du clavier en bas** (padding) → on peut toujours scroller jusqu'au dernier
   champ / bouton.
3. **Le champ focalisé remonte en haut de la zone visible**
   (`lib/ui/keyboardScroll.ts`) → on voit ce qui vient *après* lui, pas seulement lui.

### Écran

```tsx
<KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
  <TextInput … />
</KeyboardAwareScrollView>
```

Variante hook si l'écran garde son `ScrollView` (refs, scroll programmatique…) :

```tsx
const { scrollRef, handleFocus, onScroll, keyboardPadding } = useKeyboardAwareScroll();
<ScrollView
  ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16}
  keyboardShouldPersistTaps="handled"
  contentContainerStyle={[styles.content, keyboardPadding]}   // ← indispensable
>
```

### Modale

```tsx
<Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
  <KeyboardAwareOverlay style={styles.overlay} onBackdropPress={close}>
    <View style={styles.card}>…</View>
  </KeyboardAwareOverlay>
</Modal>
```

- `onBackdropPress` remplace le `onPress` de l'ancien `<Pressable style={overlay}>` (fond tapable).
- `scroll={false}` **si la carte a déjà son propre `ScrollView`/`FlatList`** : on n'imbrique pas deux
  scrolls verticaux, l'overlay se contente alors de réserver la hauteur du clavier.

## Exceptions assumées

- `components/ui/SupportThreadModal.tsx` et `app/(tabs)/conseils-ia.tsx` (conversations) utilisent
  `react-native-keyboard-controller` (`useKeyboardHandler`, barre de saisie épinglée en bas, décalage
  ajusté de la hauteur de la barre d'onglets). Réglages validés sur appareil : **ne pas y toucher**.
- `app/(tabs)/transactions/index.tsx` : le panneau « Filtres » est déplié en haut de page, son champ
  de recherche reste au-dessus du clavier ; la liste de sous-catégories a son propre défilement.

## À faire à chaque nouvel écran / modale de saisie

- [ ] Le conteneur scrollable est un `KeyboardAwareScrollView` (ou porte `keyboardPadding`).
- [ ] L'overlay de modale est un `KeyboardAwareOverlay`.
- [ ] Test réel : ouvrir le clavier sur le **dernier** champ → le bouton de validation doit être
      atteignable en scrollant.
