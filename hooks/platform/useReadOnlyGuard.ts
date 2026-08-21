/**
 * MODE « CONNECTÉ EN TANT QUE » : LECTURE SEULE.
 *
 * Un administrateur peut ouvrir le compte d'un utilisateur pour comprendre son problème. Consulter
 * doit rester consulter : rien n'empêchait pourtant les écrans de déclencher des ÉCRITURES sur les
 * données de la personne visitée — saisir une transaction, supprimer un brouillon, archiver un
 * projet, réserver un montant.
 *
 * Selon l'état de la RLS, ces écritures étaient soit refusées en 403 (message inexplicable pour
 * l'admin, qui n'a rien fait d'anormal de son point de vue), soit RÉELLEMENT appliquées au compte
 * d'un utilisateur qui n'a rien demandé — et sans trace de qui les avait faites.
 *
 * L'app pose déjà cette règle par endroits (synchro de gamification, statistiques d'usage,
 * évaluation de profil, page Comptes). Ce hook en fait une règle qu'on peut appliquer partout de
 * la même façon, au POINT D'ÉCRITURE — l'endroit où l'on ne peut pas l'oublier.
 *
 * ⚠️ C'est un garde-fou d'INTERFACE. La vraie barrière reste la RLS côté serveur : ce hook évite
 * l'accident, il ne remplace pas une policy.
 *
 * Usage :
 *     const readOnly = useReadOnlyGuard();
 *     ...
 *     if (readOnly.blocked()) return;   // affiche l'explication et interrompt
 *     maMutation.mutate(...)
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

export interface ReadOnlyGuard {
  /** Vrai pendant une consultation admin — pour griser un bouton plutôt que d'attendre le tap. */
  readOnly: boolean;
  /** À appeler AVANT toute écriture : rend `true` (et explique) s'il faut renoncer. */
  blocked: () => boolean;
}

export function useReadOnlyGuard(): ReadOnlyGuard {
  const { isImpersonating } = useAuth();

  const blocked = useCallback(() => {
    if (!isImpersonating) return false;
    Alert.alert(
      'Consultation seule',
      "Tu es connecté en tant qu'un autre utilisateur : cet écran est en lecture seule. Rien n'est modifié sur son compte.",
    );
    return true;
  }, [isImpersonating]);

  return { readOnly: isImpersonating, blocked };
}
