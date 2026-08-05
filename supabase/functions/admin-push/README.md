# Edge Function — admin-push

Envois push **admin** (immédiat, test) et **diagnostic de joignabilité**, avec le rôle service.
Alimente le panneau « Qui est joignable » de l'écran admin → Notifications → Manuelles.

## Pourquoi cette fonction existe

Avant, l'admin poussait depuis le navigateur (`lib/pushSend.ts` → `fetch` direct vers Expo). Trois
problèmes, dont un grave :

1. **On ne savait jamais si un envoi partait.** Le code faisait `try { await fetch(expo) } catch {}`
   et renvoyait le nombre de jetons lus en base. L'écran annonçait « envoyé à N appareils » même
   quand Expo avait tout refusé. C'est ce qui rendait une panne de push totalement invisible.
2. **Les jetons morts ne pouvaient pas être purgés** : `push_tokens` n'a pas de policy `DELETE` pour
   les admins (migration 063). Seul le rôle service peut le faire.
3. Un POST navigateur → `exp.host` dépend du CORS et du réseau du poste admin.

## Déploiement

```bash
# Vérif JWT ACTIVE (par défaut) : seul un admin connecté doit pouvoir appeler.
supabase functions deploy admin-push
```

Aucun secret nouveau à définir : `SUPABASE_URL`, `SUPABASE_ANON_KEY` et
`SUPABASE_SERVICE_ROLE_KEY` sont injectés automatiquement.
`BREVO_API_KEYS` (ou `BREVO_API_KEY`) est lu **s'il existe**, uniquement pour afficher le quota
e-mail restant dans le panneau — sans lui, la tuile affiche `—`.

## Actions (POST, corps JSON)

| Corps | Effet |
| --- | --- |
| `{ "action": "diagnose" }` | Compteurs de joignabilité + listes détaillées + quota Brevo |
| `{ "action": "test", "title": "...", "body": "..." }` | Envoi sur **ses propres** appareils |
| `{ "action": "send", "target": { "kind": "all" }, "title": "...", "body": "..." }` | Envoi à une cible |

`target.kind` : `all` \| `premium` \| `normal` \| `group` (+ `groupId` pour un groupe).

Toute réponse d'envoi contient `targeted`, `accepted`, `failed`, `errors[]`, `pruned`,
`config_failure` et un `summary` lisible. **`accepted` est le seul chiffre qui prouve un envoi** —
c'est lui qui est inscrit dans `admin_notifications.sent_count`.

## Sécurité

- L'appelant doit être authentifié **et** admin (`is_app_admin()` re-vérifié côté serveur).
- Le client ne lit plus les jetons des autres utilisateurs : il décrit une cible, le serveur résout.

## Lire un échec

Les codes viennent d'Expo et sont affichés tels quels dans le panneau :

| Code | Sens | Action |
| --- | --- | --- |
| `DeviceNotRegistered` | App désinstallée / jeton révoqué | Purgé automatiquement |
| `MismatchSenderId` | Le jeton vient d'un build lié à un autre projet FCM | Les appareils doivent rouvrir l'app pour réenregistrer un jeton |
| `InvalidCredentials` | Identifiants FCM/APNs du projet Expo absents ou périmés | `eas credentials` — c'est une panne globale |
| `MessageTooBig` | Titre + message trop longs | Raccourcir |
| `HTTP 4xx/5xx` | La requête n'a pas été acceptée | Le corps de la réponse est repris dans le message |

`config_failure: true` = **aucun** envoi accepté et au moins une erreur d'identifiants : la panne est
côté projet, pas côté appareils.
