# Direction artistique de l’accueil Relyka

Périmètre : vitrine web responsive et son formulaire d’administration. Logo, promesse, destinations des CTA, données et logique financière conservés. L’accueil natif reste indépendant.

## Langage visuel

- Surfaces claires : ivoire #FAFBF8, blanc #FFFFFF, sauge #EDF3EE. Encre #163D39 et texte secondaire #536B65. Conclusion #123B37. Déclinaison sombre selon le thème administré.
- Accent : vert de marque existant pour les actions et les indicateurs ; aucun halo circulaire ni mouvement perpétuel.
- Police globale existante (système par défaut), sans nouvelle dépendance ; police du logo conservée. H1 64/68 bureau, 40/44 mobile ; H2 44/50 et 32/38 ; body 17/27 ; captions 12/18 ; eyebrows 11/16 espacés.
- Grille 1200 px maximum, marges 48 px bureau / 22 px mobile. Espacements 8, 16, 24, 32, 48, 64, 96. Deux colonnes à partir de 980 px.
- Boutons de 48 px minimum, rayon 8 ; surfaces produit rayon 16 ; bordures uniquement pour séparer ou délimiter l’application ; ombre légère réservée à son aperçu.
- Icônes Ionicons existantes. Aperçus de démonstration explicitement signalés, indépendants de toute donnée personnelle.

## Composition

Hero éditorial à gauche, fenêtre produit à droite sur une surface sauge décalée. Projection et transaction dans le même contexte. Sur téléphone : texte plus court en largeur, commandes adaptées et aperçu sans navigation latérale.

Fonctionnalités : introduction alignée à gauche, grand aperçu budget/projet avec les deux premières fonctionnalités, puis liste ouverte des autres fonctionnalités avec séparateurs. Les listes restent éditables, y compris vides.

Engagements : valeurs existantes présentées avec leur sens, sans métriques inventées. Conclusion pleine largeur sombre avec image de fond facultative et panneau de texte lisible. Footer simple, logo et liens légaux.

## Administration et compatibilité

Conserver app_config.landing et les champs existants ; ajouter un objet presentation fusionné avec ses défauts pour les anciennes configurations. Images hero et produit, fond de conclusion : URL ou upload existant, alternative textuelle, ajustement contain/cover, couleur hexadécimale et opacité 0–100 %. Sans image : démonstration produit ou fond uni. Les textes des nouveaux aperçus sont éditables. Éditeur réparti par sections avec prévisualisation des images et conservation des contrôles existants.

Vérification : compatibilité des configurations anciennes, sauvegarde et fusion des médias, typage, compilation web, inspection responsive si navigateur disponible. Aucune publication distante automatique.
