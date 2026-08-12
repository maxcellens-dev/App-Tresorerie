-- Migration 085 : passage des conseils (Pilotage) au TUTOIEMENT.
-- On ne change QUE le vouvoiement (vous/votre/vos/impératifs), sans toucher aux tournures.
-- Chaque UPDATE matche le TEXTE EXACT du seed (043) → un conseil édité en admin n'est pas écrasé.

-- ── Conseils généraux ──
UPDATE conseils SET message =
  'Les intérêts composés font toute la différence sur la durée. Un placement régulier, même modeste, prend de l''ampleur au fil des ans — le temps est ton principal atout.'
WHERE message =
  'Les intérêts composés font toute la différence sur la durée. Un placement régulier, même modeste, prend de l''ampleur au fil des ans — le temps est votre principal atout.';

UPDATE conseils SET message =
  'La règle 50 / 30 / 20 est un point de départ : environ 50 % pour les besoins, 30 % pour les envies, 20 % pour l''épargne. À adapter à ta situation réelle.'
WHERE message =
  'La règle 50 / 30 / 20 est un point de départ : environ 50 % pour les besoins, 30 % pour les envies, 20 % pour l''épargne. À adapter à votre situation réelle.';

UPDATE conseils SET message =
  'Rembourser un crédit conso à 15 % rapporte plus que tout placement. Avant d''investir, solde les dettes coûteuses — c''est la décision financière la plus rentable.'
WHERE message =
  'Rembourser un crédit conso à 15 % rapporte plus que tout placement. Avant d''investir, soldez les dettes coûteuses — c''est la décision financière la plus rentable.';

UPDATE conseils SET message =
  'Un fonds d''urgence couvre les imprévus sans toucher à tes investissements. L''objectif : 3 à 6 mois de charges essentielles disponibles à tout moment.'
WHERE message =
  'Un fonds d''urgence couvre les imprévus sans toucher à vos investissements. L''objectif : 3 à 6 mois de charges essentielles disponibles à tout moment.';

UPDATE conseils SET message =
  'L''inflation érode silencieusement l''argent qui dort sur un compte courant. Au-delà de ta réserve de sécurité, l''argent qui ne travaille pas perd de la valeur chaque année.'
WHERE message =
  'L''inflation érode silencieusement l''argent qui dort sur un compte courant. Au-delà de votre réserve de sécurité, l''argent qui ne travaille pas perd de la valeur chaque année.';

-- ── Conseils contextuels ──
UPDATE conseils SET message =
  'Tu gardes {checking}€ sur le compte courant. Au-delà de ta sécurité, cet argent perd de la valeur avec l''inflation.'
WHERE message =
  'Vous gardez {checking}€ sur le compte courant. Au-delà de votre sécurité, cet argent perd de la valeur avec l''inflation.';

UPDATE conseils SET message =
  '{savings_months} mois de dépenses en réserve. La question n''est plus vraiment d''épargner plus — c''est de décider quoi faire avec ce que tu as déjà.'
WHERE message =
  '{savings_months} mois de dépenses en réserve. La question n''est plus vraiment d''épargner plus — c''est de décider quoi faire avec ce que vous avez déjà.';

UPDATE conseils SET message =
  'Ta réserve couvre moins de 2 mois de dépenses. En cas d''imprévu, tu serais rapidement en difficulté.'
WHERE message =
  'Votre réserve couvre moins de 2 mois de dépenses. En cas d''imprévu, vous seriez rapidement en difficulté.';

UPDATE conseils SET message =
  'Tu as déjà dépassé ton budget ce mois-ci. Les dépenses qui restent seront à surveiller de près.'
WHERE message =
  'Vous avez déjà dépassé votre budget ce mois-ci. Les dépenses qui restent seront à surveiller de près.';

UPDATE conseils SET message =
  'Ton projet {projet_nom} est créé depuis {projet_jours} jours, mais aucun versement n''a été fait. Est-ce qu''il est toujours d''actualité ?'
WHERE message =
  'Votre projet {projet_nom} est créé depuis {projet_jours} jours, mais aucun versement n''a été fait. Est-ce qu''il est toujours d''actualité ?';

UPDATE conseils SET message =
  'Il reste {delai} mois pour ton projet {projet_nom}, mais tu n''en es qu''à {pct}%. Il faut soit accélérer, soit revoir l''objectif ou la date.'
WHERE message =
  'Il reste {delai} mois pour votre projet {projet_nom}, mais vous n''en êtes qu''à {pct}%. Il faut soit accélérer, soit revoir l''objectif ou la date.';

UPDATE conseils SET message =
  'Ton patrimoine progresse depuis {n} mois. C''est {gain}€ de plus par rapport à {date_debut}.'
WHERE message =
  'Votre patrimoine progresse depuis {n} mois. C''est {gain}€ de plus par rapport à {date_debut}.';

UPDATE conseils SET message =
  'Tes revenus ont augmenté de {delta}€ par mois en moyenne. C''est une bonne occasion de revoir ce que tu mets de côté avant que les dépenses n''absorbent la différence.'
WHERE message =
  'Vos revenus ont augmenté de {delta}€ par mois en moyenne. C''est une bonne occasion de revoir ce que vous mettez de côté avant que les dépenses n''absorbent la différence.';

UPDATE conseils SET message =
  'Tu investis plus que tu n''épargnes. Si un imprévu arrive, tu risques de devoir toucher à tes investissements au pire moment.'
WHERE message =
  'Vous investissez plus que vous n''épargnez. Si un imprévu arrive, vous risquez de devoir toucher à vos investissements au pire moment.';

UPDATE conseils SET message =
  'La majorité de ton patrimoine est sur des comptes liquides. Une partie dort probablement sans rendement réel.'
WHERE message =
  'La majorité de votre patrimoine est sur des comptes liquides. Une partie dort probablement sans rendement réel.';

-- ── Conseils contextuels « trésorerie » (vague 2, migration 046) ──
UPDATE conseils SET message =
  'En continuant ainsi, ton solde courant passerait dans le rouge dès {mois} (≈ {solde}€). Anticipe : réduis une dépense ou décale une sortie.'
WHERE message =
  'En continuant ainsi, votre solde courant passerait dans le rouge dès {mois} (≈ {solde}€). Anticipez : réduisez une dépense ou décalez une sortie.';

UPDATE conseils SET message =
  'D''ici quelques mois, ta trésorerie deviendrait négative — vers {mois} (≈ {solde}€). Il est encore temps d''ajuster tes dépenses ou tes virements.'
WHERE message =
  'D''ici quelques mois, votre trésorerie deviendrait négative — vers {mois} (≈ {solde}€). Il est encore temps d''ajuster vos dépenses ou vos virements.';

UPDATE conseils SET message =
  'Au rythme actuel, ton solde courant fondrait à ≈ {solde}€ d''ici 6 mois, soit {baisse}€ de moins qu''aujourd''hui. Surveille ce qui sort chaque mois.'
WHERE message =
  'Au rythme actuel, votre solde courant fondrait à ≈ {solde}€ d''ici 6 mois, soit {baisse}€ de moins qu''aujourd''hui. Surveillez ce qui sort chaque mois.';

UPDATE conseils SET message =
  'Ta trésorerie reste solide : ≈ {solde}€ prévus d''ici 6 mois en continuant ainsi. C''est une bonne marge pour épargner ou investir une partie.'
WHERE message =
  'Votre trésorerie reste solide : ≈ {solde}€ prévus d''ici 6 mois en continuant ainsi. C''est une bonne marge pour épargner ou investir une partie.';
