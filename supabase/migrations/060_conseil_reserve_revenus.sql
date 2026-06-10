-- Migration 060 : Le conseil « épargne confortable » compte désormais des mois de REVENUS
-- (combien de temps l'épargne tient si les revenus s'arrêtent), plus des mois de dépenses.
-- On corrige le libellé seulement s'il porte encore l'ancien texte (préserve une édition admin).

UPDATE conseils
SET message = '{savings_months} mois de revenus en réserve. La question n''est plus vraiment d''épargner plus — c''est de décider quoi faire avec ce que vous avez déjà.'
WHERE critere_key = 'epargne_confortable'
  AND message LIKE '%mois de dépenses en réserve%';

UPDATE conseils
SET message = 'Votre réserve couvre moins de 2 mois de revenus. En cas d''imprévu, vous seriez rapidement en difficulté.'
WHERE critere_key = 'epargne_insuffisante'
  AND message LIKE '%moins de 2 mois de dépenses%';
