/**
 * Accès & compteur des Conseils Intelligents (lib/ai/aiAccess).
 *
 * Ces règles doivent coïncider avec celles appliquées par l'Edge Function `ai-advice` : chaque cas
 * ci-dessous correspond à une divergence réellement constatée entre ce que la page AFFICHAIT et ce
 * que le serveur AUTORISAIT (compteur « 0 / 0 » au chargement, crédits achetés inutilisables,
 * feuille d'achat vide, mur alors que la bascule payante est active…).
 */
import { resolveAiAccess, type AiAccessInput, type AiQuotaLike } from '../lib/ai/aiAccess';

const quota = (over: Partial<AiQuotaLike> = {}): AiQuotaLike => ({
  used: 0, limit: 10, remaining: 10, is_premium: true, extra_credits: 0, ...over,
});

const base = (over: Partial<AiAccessInput> = {}): AiAccessInput => ({
  isPremium: true, planResolved: true, isAdmin: false, isImpersonating: false,
  profileReady: true, cfgReady: true, quotaSettled: true,
  openToAll: false, payToUseEnabled: false, paidFallbackEnabled: false, packsCount: 0,
  quota: quota(),
  ...over,
});

describe('resolveAiAccess — accès', () => {
  it('ouvre la page à un abonné, à un admin et quand la fonctionnalité est ouverte à tous', () => {
    expect(resolveAiAccess(base()).allowed).toBe(true);
    expect(resolveAiAccess(base({ isPremium: false, isAdmin: true })).allowed).toBe(true);
    expect(resolveAiAccess(base({ isPremium: false, openToAll: true })).allowed).toBe(true);
  });

  it('refuse un utilisateur gratuit sans crédit', () => {
    const a = resolveAiAccess(base({ isPremium: false, quota: quota({ limit: 1, remaining: 0 }) }));
    expect(a.allowed).toBe(false);
    expect(a.readOnly).toBe(true);
  });

  it('OUVRE l\'accès à un non-abonné qui détient des requêtes achetées (le serveur les accepte)', () => {
    const a = resolveAiAccess(base({ isPremium: false, quota: quota({ limit: 1, remaining: 0, extra_credits: 4 }) }));
    expect(a.allowed).toBe(true);
    expect(a.available).toBe(4);
    expect(a.canSend).toBe(true);
  });

  it('attend la réponse du quota avant de refuser (sinon un crédit acheté serait ignoré)', () => {
    const loading = base({ isPremium: false, quotaSettled: false, quota: null });
    expect(resolveAiAccess(loading).accessReady).toBe(false);
    // Un abonné, lui, n'a pas besoin d'attendre le quota pour entrer.
    expect(resolveAiAccess(base({ quotaSettled: false, quota: null })).accessReady).toBe(true);
  });

  it('reste en attente tant que le profil ou la config n\'a pas répondu', () => {
    expect(resolveAiAccess(base({ profileReady: false })).accessReady).toBe(false);
    expect(resolveAiAccess(base({ cfgReady: false })).accessReady).toBe(false);
  });

  /* `isPremium` vaut faux par DÉFAUT tant que les drapeaux d'offre ne sont pas revenus — et
     définitivement si leur lecture échoue. Sans attendre la réponse du plan, la page opposait le
     mur « réservé aux abonnés Premium » à un abonné. */
  it('attend la réponse du PLAN avant de refuser l\'accès', () => {
    expect(resolveAiAccess(base({ isPremium: false, planResolved: false })).accessReady).toBe(false);
    // Un accès acquis autrement (admin, ouverture à tous) n'attend rien.
    expect(resolveAiAccess(base({ isPremium: false, planResolved: false, isAdmin: true })).accessReady).toBe(true);
    expect(resolveAiAccess(base({ isPremium: false, planResolved: false, openToAll: true })).accessReady).toBe(true);
  });

  it('passe en lecture seule pendant une consultation admin (« connecté en tant que »)', () => {
    const a = resolveAiAccess(base({ isImpersonating: true }));
    expect(a.readOnly).toBe(true);
    expect(a.canSend).toBe(false);
    expect(a.canRecharge).toBe(false);
    expect(a.outOfRequests).toBe(false);
  });
});

describe('resolveAiAccess — compteur', () => {
  it('n\'affiche aucun chiffre tant que le quota n\'est pas lu, et laisse partir la demande', () => {
    const a = resolveAiAccess(base({ quota: undefined }));
    expect(a.quotaLoaded).toBe(false);
    expect(a.canSend).toBe(true);      // le serveur reste le garde-fou
    expect(a.outOfRequests).toBe(false); // pas de bandeau « plus de requêtes » au chargement
  });

  it('additionne requêtes incluses et rechargées', () => {
    const a = resolveAiAccess(base({ quota: quota({ limit: 10, remaining: 3, extra_credits: 5 }) }));
    expect(a.available).toBe(8);
    expect(a.totalRequests).toBe(15);
  });

  it('borne les valeurs aberrantes (limite négative saisie en admin)', () => {
    const a = resolveAiAccess(base({ quota: quota({ limit: -5, remaining: -2, extra_credits: -1 }) }));
    expect(a.available).toBe(0);
    expect(a.totalRequests).toBe(0);
    expect(a.extraCredits).toBe(0);
  });
});

describe('resolveAiAccess — quota épuisé', () => {
  const empty = { limit: 10, remaining: 0, extra_credits: 0 };

  it('bloque et explique quand la recharge n\'est pas proposée', () => {
    const a = resolveAiAccess(base({ quota: quota(empty) }));
    expect(a.canSend).toBe(false);
    expect(a.outOfRequests).toBe(true);
    expect(a.canRecharge).toBe(false);
  });

  it('propose la recharge seulement si elle est activée ET qu\'il existe des offres', () => {
    expect(resolveAiAccess(base({ quota: quota(empty), payToUseEnabled: true, packsCount: 0 })).canRecharge).toBe(false);
    expect(resolveAiAccess(base({ quota: quota(empty), payToUseEnabled: false, packsCount: 3 })).canRecharge).toBe(false);
    expect(resolveAiAccess(base({ quota: quota(empty), payToUseEnabled: true, packsCount: 3 })).canRecharge).toBe(true);
  });

  it('n\'oppose AUCUN mur quand la bascule payante éditeur est active (le serveur sert quand même)', () => {
    const a = resolveAiAccess(base({ quota: quota(empty), paidFallbackEnabled: true }));
    expect(a.canSend).toBe(true);
    expect(a.outOfRequests).toBe(false);
  });
});
