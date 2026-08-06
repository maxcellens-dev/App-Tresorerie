import { parentRoute } from '../lib/navHistory';

/**
 * `parentRoute` n'est utilisé QUE lorsqu'il n'y a pas d'historique (ouverture par URL,
 * rechargement web, arrivée directe après connexion). Il doit donc toujours viser une route qui
 * EXISTE — sinon « Retour » mène à une page introuvable, ce qui est pire que le tableau de bord.
 */
describe('parentRoute — le repli de « Retour » quand l’historique est vide', () => {
  it('remonte d’un cran sur les pages admin', () => {
    expect(parentRoute('/admin/seo-center')).toBe('/admin');
    expect(parentRoute('/admin/pouls')).toBe('/admin');
    expect(parentRoute('/admin/recommendations')).toBe('/admin');
  });

  it('renvoie null à la racine (→ le tableau de bord prend le relais)', () => {
    expect(parentRoute('/admin')).toBeNull();
    expect(parentRoute('/pilotage')).toBeNull();
    expect(parentRoute('/')).toBeNull();
    expect(parentRoute(null)).toBeNull();
    expect(parentRoute(undefined)).toBeNull();
  });

  it('saute les dossiers de rangement, qui ne sont pas des pages', () => {
    // /comptes/edit et /transactions/edit n'existent pas : seul le [id] y vit.
    expect(parentRoute('/comptes/edit/42')).toBe('/comptes');
    expect(parentRoute('/comptes/credit/42')).toBe('/comptes');
    expect(parentRoute('/transactions/edit/42')).toBe('/transactions');
  });

  it('garde les vraies pages intermédiaires', () => {
    expect(parentRoute('/comptes/42')).toBe('/comptes');
    expect(parentRoute('/transactions/add')).toBe('/transactions');
    expect(parentRoute('/relyka-world/42')).toBe('/relyka-world');
  });
});
