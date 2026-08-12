-- Migration 046 : Conseils contextuels « vague 2 » — basés sur la trésorerie FUTURE
--
-- Ces conseils s'appuient sur la projection des soldes des prochains mois (6 mois glissants),
-- utile notamment pour les revenus irréguliers ou quand l'utilisateur ne saisit pas le futur.
-- Les variables {mois}, {solde}, {baisse} sont remplacées côté client.

INSERT INTO conseils (type, message, critere_key, display_order) VALUES
  ('contextuel', 'En continuant ainsi, votre solde courant passerait dans le rouge dès {mois} (≈ {solde}€). Anticipez : réduisez une dépense ou décalez une sortie.', 'treso_negatif_mois_prochain', 20),
  ('contextuel', 'D''ici quelques mois, votre trésorerie deviendrait négative — vers {mois} (≈ {solde}€). Il est encore temps d''ajuster vos dépenses ou vos virements.', 'treso_negatif_6mois', 21),
  ('contextuel', 'Au rythme actuel, votre solde courant fondrait à ≈ {solde}€ d''ici 6 mois, soit {baisse}€ de moins qu''aujourd''hui. Surveillez ce qui sort chaque mois.', 'treso_erosion_6mois', 22),
  ('contextuel', 'Votre trésorerie reste solide : ≈ {solde}€ prévus d''ici 6 mois en continuant ainsi. C''est une bonne marge pour épargner ou investir une partie.', 'treso_solide_6mois', 23)
ON CONFLICT DO NOTHING;
