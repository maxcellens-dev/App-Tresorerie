/**
 * RootPortal — téléporte des enfants au SOMMET de l'arbre, DANS LA MÊME FENÊTRE que le contenu.
 *
 * Pourquoi : un `<Modal>` Android vit dans une FENÊTRE séparée. Y dessiner un surlignage positionné
 * d'après `measureInWindow` (mesuré, lui, dans la fenêtre PRINCIPALE) donne un décalage constant —
 * aggravé par l'edge-to-edge de react-native-keyboard-controller, qui ne s'applique qu'à la fenêtre
 * principale. Résultat : les cadres du guide tombaient au-dessus des boutons réels.
 *
 * En passant par ce portail, le guide est rendu par `RootPortalHost` (monté une fois à la racine,
 * dans app/_layout), donc dans la MÊME fenêtre que les boutons → measureInWindow et le dessin
 * partagent exactement le même repère, sur n'importe quel appareil. Plus aucune estimation.
 */
import React, { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Registry = Record<string, React.ReactNode>;

let publish: ((r: Registry) => void) | null = null;
let registry: Registry = {};

function emit() {
  publish?.({ ...registry });
}

/** Monté UNE fois à la racine de l'app (dans la fenêtre principale, au-dessus de la navigation). */
export function RootPortalHost() {
  const [nodes, setNodes] = useState<Registry>({});
  useEffect(() => {
    publish = setNodes;
    setNodes({ ...registry }); // rattrape ce qui a été enregistré avant le montage du host
    return () => { publish = null; };
  }, []);

  const list = Object.entries(nodes);
  if (list.length === 0) return null; // rien à afficher → aucun calque, aucune capture de touch
  return (
    <View style={styles.host} pointerEvents="box-none">
      {list.map(([id, node]) => (
        <React.Fragment key={id}>{node}</React.Fragment>
      ))}
    </View>
  );
}

/** Rend ses enfants dans le host racine (même fenêtre). Ne dessine rien à son emplacement d'origine. */
export function RootPortal({ children }: { children: React.ReactNode }) {
  const id = useId();
  useEffect(() => {
    registry[id] = children;
    emit();
    return () => { delete registry[id]; emit(); };
  }, [id, children]);
  return null;
}

const styles = StyleSheet.create({
  // Au-dessus de TOUT (navigation, barre d'onglets) dans la fenêtre principale.
  host: { ...StyleSheet.absoluteFill, zIndex: 100000, elevation: 100000 },
});
