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
supabase functions deploy admin-push

# Fonctions mises à jour (elles lisent maintenant la réponse d'Expo)
supabase functions deploy send-scheduled-notifications --no-verify-jwt
supabase functions deploy notify-admins

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

## 3. Le bouton « M'envoyer un push de test »

C'est le geste décisif : il envoie sur **tes propres appareils** et affiche la réponse d'Expo
telle quelle.

| Résultat | Conclusion |
| --- | --- |
| ✓ accepté **et** le téléphone sonne | La chaîne fonctionne. Si un envoi ciblé ne part pas, c'est le ciblage (groupe vide, `notifications_enabled` à false). |
| ✓ accepté mais **rien n'arrive** | Expo a pris le message ; la suite se joue chez Apple/Google. Vérifie les réglages de notification du téléphone, le mode Concentration, et que le build installé est bien celui du projet Expo courant. |
| ✗ `InvalidCredentials` | **Panne globale.** Les identifiants FCM/APNs du projet Expo sont absents ou périmés → `eas credentials`. Voir étape 5. |
| ✗ `MismatchSenderId` | Le jeton vient d'un build lié à un **autre** projet FCM. Les appareils doivent rouvrir l'app pour réenregistrer un jeton. Fréquent après un changement de `google-services.json`. |
| ✗ `DeviceNotRegistered` | Jeton mort — purgé automatiquement. Rouvre l'app mobile pour en réenregistrer un. |
| « Aucun appareil enregistré pour ton compte » | Tu n'as pas de jeton : ouvre l'app **mobile** et accepte les notifications. |

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
