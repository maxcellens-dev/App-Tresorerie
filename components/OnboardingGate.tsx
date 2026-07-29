/**
 * OnboardingGate — NEUTRALISÉ.
 *
 * Il déclenchait le tour ancré OBLIGATOIRE (3 bulles sur l'écran Comptes) juste après le
 * questionnaire. Ce tour faisait doublon : il présentait l'interface sans jamais expliquer LE
 * chiffre, alors que le guide de démarrage (contexts/GuideContext) installe réellement les comptes,
 * et que la vue de découverte du tableau de bord (components/DiscoveryIntro) explique les quatre
 * décisions et les deux façons de se servir de l'app.
 *
 * Le composant reste monté et le tour reste RELANÇABLE à la main depuis l'assistance
 * (TourContext.start()), pour ne casser ni ce bouton ni le parcours des comptes existants — dont
 * `app_tour_done` vaut déjà true, donc pour qui rien ne change.
 */
export default function OnboardingGate() {
  return null;
}
