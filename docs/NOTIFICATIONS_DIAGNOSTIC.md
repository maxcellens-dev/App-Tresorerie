# Notifications push — remettre en route et diagnostiquer

> À lire dans l'ordre. Chaque étape élimine une cause : ne saute pas la 1 pour aller à la 4.

## Ce qui n'allait pas (et pourquoi ça semblait « s'arrêter sans raison »)

Les trois chemins d'envoi faisaient tous ceci :

```ts
await fetch('https://exp.host/--/api/v2/push/send', { ... });   // et rien d'autre
```

La réponse n'était jamais lue. Or **l'API Expo répond `200 OK` même quand elle refuse tous les
messages** : le détail est dans le corps, un « ticket » par destinataire, avec un code
(`DeviceNotRegistered`, `MismatchSenderId`, `InvalidCredentials`…).

Conséquences, toutes invisibles :

- l'écran admin annonçait « envoyé à N appareils » en comptant les **jetons lus en base**, ce qui ne
  prouve aucun envoi ;
- une planification échouée était quand même marquée « envoyée » (`last_sent_at`), donc
  **l'occurrence était perdue** — exactement le cas « je n'ai pas reçu ma notification mensuelle » ;
- les jetons morts s'accumulaient et gonflaient le compteur d'audience.

Corrigé par `supabase/functions/_shared/expoPush.ts`, utilisé désormais par les trois chemins.

## 1. Déployer

```bash
# Nouvelle fonction : envoi admin + diagnostic (vérif JWT ACTIVE, c'est voulu)
npx supabase functions deploy admin-push

# Fonctions mises à jour (elles lisent maintenant la réponse d'Expo)
npx supabase functions deploy send-scheduled-notifications --no-verify-jwt
npx supabase functions deploy notify-admins

# Migration du drapeau « crédit partagé »
supabase db push        # ou colle 166_credit_is_shared.sql dans le SQL Editor
```

> ⚠️ `send-scheduled-notifications` **doit** rester en `--no-verify-jwt` : le cron s'authentifie par
> `CRON_SECRET`, qui n'est pas un JWT. Déployée normalement, la passerelle renvoie 401 avant même
> d'exécuter la fonction.

## 2. Regarder le panneau « Qui est joignable »

App → **Admin → Notifications → onglet Manuelles → Diagnostic**.

| Ce que tu lis | Ce que ça veut dire |
| --- | --- |
| « Joignables en push » à **0** | Personne n'a de jeton valide **ou** tout le monde a coupé les notifs. Le problème est en amont de l'envoi. |
| « Sans appareil » élevé | Les utilisateurs n'ont jamais ouvert l'app **mobile** (le web n'enregistre pas de jeton push). |
| « Joignables en push » > 0 | L'audience existe : si rien n'arrive, c'est l'envoi. Passe à l'étape 3. |

Clique un compteur pour voir **qui** est dedans.

> Le diagnostic **e-mail** est ailleurs : **Admin → E-mails → Diagnostic**. Deux canaux, deux pannes
> sans rapport (jetons et credentials FCM/APNs d'un côté, quota Brevo et opt-out de l'autre).

## 3. L'envoi de test

C'est le geste décisif : il envoie sur les appareils d'**un destinataire au choix** et affiche la
réponse d'Expo telle quelle.

- par défaut, il part sur **tes** appareils → teste la chaîne d'envoi ;
- ouvre « Joignables en push » et touche quelqu'un pour viser **son** téléphone → seul moyen de
  distinguer « plus rien ne part » de « cet appareil-là ne reçoit pas ».

| Résultat | Conclusion |
| --- | --- |
| ✓ accepté **et** le téléphone sonne | La chaîne fonctionne. Si un envoi ciblé ne part pas, c'est le ciblage (groupe vide, `notifications_enabled` à false). |
| ✓ accepté mais **rien n'arrive** | Lis le bloc **« Livraison (accusés de réception) »** juste en dessous : c'est lui qui tranche (voir 3 bis). |
| ✗ `InvalidCredentials` | **Panne globale.** Les identifiants FCM/APNs du projet Expo sont absents ou périmés → `eas credentials`. Voir étape 5. |
| ✗ `MismatchSenderId` | Le jeton vient d'un build lié à un **autre** projet FCM. Les appareils doivent rouvrir l'app pour réenregistrer un jeton. Fréquent après un changement de `google-services.json`. |
| ✗ `DeviceNotRegistered` | Jeton mort — purgé automatiquement. Rouvre l'app mobile pour en réenregistrer un. |
| « Aucun appareil enregistré pour… » | Ce compte n'a pas de jeton : il faut ouvrir l'app **mobile** et accepter les notifications. |
| ✓ accepté + « a COUPÉ ses notifications » | L'envoi est parti, mais ce destinataire a désactivé les notifications dans l'app : rien ne s'affichera. Ce n'est pas une panne. |

## 3 bis. « Expo a accepté » ≠ « c'est arrivé »

C'est le piège central de l'API Expo, et la raison pour laquelle un push peut sembler fonctionner
alors que rien n'arrive :

| Étape | Ce que ça prouve |
| --- | --- |
| **Ticket** (`status: ok`, à l'envoi) | Expo a **mis en file**. Rien de plus. |
| **Receipt** (accusé, quelques secondes après) | Ce qu'Apple/Google en ont **réellement fait**. |

Le panneau lit désormais les deux. Le bloc « Livraison (accusés de réception) » donne le verdict :

| Receipt | Conclusion |
| --- | --- |
| ✓ remise confirmée | **Le message EST arrivé.** S'il ne s'affiche pas : centre de notifications, mode Concentration, autorisation de Relyka dans les réglages du téléphone, ou canal Android en importance basse. |
| `DeviceNotRegistered` | Le jeton ne vaut plus rien (app désinstallée, ou jeton d'un ancien build). Rouvrir l'app mobile pour en réenregistrer un. |
| `MismatchSenderId` | Le jeton vient d'un build lié à un **autre** projet FCM. Panne typique après un changement de `google-services.json`. |
| `InvalidCredentials` | Identifiants FCM/APNs absents ou périmés → `eas credentials`. Rien ne partira tant que ce n'est pas réglé. |
| « pas encore disponible » | Expo n'a pas fini. Relancer le test une minute plus tard. |

### `DeviceNotRegistered` : personne ne doit réinstaller l'app

C'est le point important à l'échelle du parc — **jamais** on ne peut demander à des utilisateurs de
désinstaller/réinstaller. La chaîne se répare donc toute seule :

1. **Le serveur purge** le jeton mort dès l'envoi qui le révèle (aux deux étapes : ticket ET
   receipt). Un jeton `DeviceNotRegistered` disparaît de `push_tokens` sans intervention.
2. **Le client réenregistre** à chaque lancement (`PushRegistrar` dans `app/_layout.tsx`) et fait un
   `upsert` : un jeton frais réapparaît à la prochaine ouverture de l'app.

Le cycle se referme sans que l'utilisateur fasse quoi que ce soit. Un compte peut rester une journée
sans jeton — pas plus.

**Si le jeton reste mort après réouverture**, c'est que le client n'en produit pas de nouveau. Deux
causes, que le bouton **Paramètres → « Je ne reçois aucune notification »** distingue :

| Ce que dit le diagnostic | Cause | Correction |
| --- | --- | --- |
| `getExpoPushTokenAsync a ECHOUE` | Permission OS refusée, Google Play Services, ou credentials absents du build | Réglages du téléphone, ou `eas credentials` |
| Un jeton s'affiche, mais rien n'arrive quand même | Le **build natif installé** n'a plus les identifiants FCM/APNs du projet | **Installer la dernière version depuis le store.** Une mise à jour OTA ne peut PAS corriger ça : elle ne remplace que le JavaScript, jamais la couche native qui porte l'enregistrement push. |

Le second cas est le piège classique après une migration de SDK ou un changement de
`google-services.json` : les téléphones restés sur l'ancien build gardent un jeton qu'Expo accepte
mais que Google refuse.

### Deux réglages corrigés au passage

- **`channelId: 'default'` explicite** dans le message. Sans lui, Android rangeait la notification
  dans un canal de repli créé par `expo-notifications` — pas celui que l'app configure. Un canal de
  repli peut être muet ou masqué sans que rien ne le signale.
- **Canal Android en importance `HIGH`** (au lieu de `DEFAULT`). En `DEFAULT`, Android dépose la
  notification dans le tiroir **sans bandeau ni son** : on ne la voit qu'en déroulant la barre
  d'état. ⚠️ Android fige l'importance à la **création** du canal : sur un téléphone où Relyka est
  déjà installée, ce changement n'a **aucun effet**. Pour ceux-là, il faut passer par
  *Réglages → Notifications → Relyka*, ou réinstaller.

## 4. Vérifier que le cron tourne encore

L'exécution des planifications ne dépend pas de Supabase mais de **cron-job.org**. C'est la cause la
plus banale d'un « ça marchait avant » : un job désactivé après une série d'échecs, ou un secret
changé.

1. cron-job.org → le job qui appelle `send-scheduled-notifications`.
2. **Le job est-il activé ?** (cron-job.org désactive tout seul après trop d'échecs consécutifs.)
3. Onglet **Historique d'exécution** → dernière réponse. Elle est désormais parlante :

```json
{ "ok": true, "processed": 4, "fired": 1,
  "results": [{ "id": "…", "title": "Le Point", "targeted": 11, "accepted": 11, "failed": 0 }],
  "failures": [] }
```

| Réponse | Cause |
| --- | --- |
| `401 unauthorized` | `CRON_SECRET` ne correspond plus. Recolle l'en-tête `Authorization: Bearer <secret>`. |
| `"fired": 0` en permanence | Aucune planification n'est due : vérifie l'heure, le fuseau (`timezone`), le jour du mois et `active`. |
| `failures` non vide | L'envoi a échoué : le motif y est écrit. Retour à l'étape 3. |
| Aucune exécution récente | Le job est arrêté côté cron-job.org. |

Pour tester sans attendre, appelle la fonction à la main :

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/send-scheduled-notifications" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

> Depuis la correction, un échec total **ne consomme plus l'occurrence** : `last_sent_at` n'est pas
> avancé et le cron retentera. Une périodique n'est due que le bon jour ; un envoi ponctuel est
> abandonné 24 h après son `trigger_at`.

## 5. Les logs Supabase (si les étapes 2–4 ne suffisent pas)

**Dashboard → Edge Functions → `send-scheduled-notifications` (ou `admin-push`) → Logs.**

Cherche :

- `[send-scheduled] « <titre> » : … en échec — <code> ×N` — l'échec par planification ;
- `PANNE GLOBALE : Expo refuse tous les envois` — les identifiants du projet sont en cause ;
- `[expoPush] purge des jetons morts échouée` — la purge n'a pas pu s'exécuter (rare).

Requête utile dans le **SQL Editor** — les envois qui n'ont touché personne :

```sql
select created_at, title, sent_count, target_label, source
from admin_notifications
order by created_at desc
limit 30;
```

`sent_count = 0` sur une ligne récente = l'occurrence a bien été tentée et n'a rien produit.

Et l'état de l'audience :

```sql
select count(*) filter (where p.notifications_enabled) as notifs_on,
       count(distinct t.profile_id)                    as avec_appareil,
       count(*)                                        as jetons
from push_tokens t
join profiles p on p.id = t.profile_id;
```

## 6. Ce qui reste hors de l'app

Si Expo **accepte** et que rien n'arrive, le problème est entre Expo et le téléphone :

- **Android** — `google-services.json` doit correspondre au projet FCM déclaré dans les credentials
  Expo. Un changement de l'un sans l'autre donne `MismatchSenderId`.
- **iOS** — la clé APNs doit être valide et rattachée au bon identifiant d'app.
- Un build **de développement** et un build de **production** peuvent porter des credentials
  différents : vérifie sur quel build tourne le téléphone qui ne reçoit rien.

```bash
eas credentials      # inspecter / renouveler FCM et APNs
```
