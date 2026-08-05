# Edge Function — send-scheduled-notifications

Envoie les **notifications planifiées** dues (ponctuelles ou périodiques) gérées dans
l'écran admin → Notifications. À appeler **toutes les minutes** par cron-job.org.

## Déploiement (une fois)

```bash
# 1. Définir le secret partagé (même valeur que pour refresh-currency-rates si tu veux le réutiliser)
supabase secrets set CRON_SECRET=<un-secret-long-aleatoire>

# 2. Déployer la fonction SANS vérif JWT (l'auth se fait par CRON_SECRET)
supabase functions deploy send-scheduled-notifications --no-verify-jwt
```

L'URL de la fonction :
`https://<PROJECT_REF>.supabase.co/functions/v1/send-scheduled-notifications`

## Cron (cron-job.org)

Crée un cron job :
- **URL** : l'URL ci-dessus
- **Méthode** : `POST` (ou GET, peu importe)
- **Planning** : toutes les minutes (`* * * * *`) — ou toutes les 5 min si tu acceptes une marge.
- **En-tête HTTP** : `Authorization: Bearer <CRON_SECRET>`
  (ou `x-cron-secret: <CRON_SECRET>`)

À chaque appel, la fonction :
1. Lit les planifications `active = true`.
2. Pour chacune, vérifie si elle est **due maintenant** (ponctuelle échue / périodique à l'heure
   locale du bon jour, pas déjà envoyée aujourd'hui).
3. Envoie le push Expo à tous les utilisateurs `notifications_enabled = true`.
4. Écrit l'envoi dans `admin_notifications` (historique) et met à jour `last_sent_at`
   (et désactive les ponctuelles).

## Réponse

```json
{ "ok": true, "processed": 3, "fired": 1, "results": [{ "id": "...", "title": "...", "devices": 42 }] }
```

## Notes
- Les heures périodiques sont en **heure locale** du fuseau de la planif (`timezone`, défaut
  `Europe/Paris`). L'envoi se fait au 1ᵉ passage du cron **après** l'heure cible, **1×/jour** max.
- Idempotent par jour grâce à `last_sent_at`. Pas de double envoi même si le cron tourne souvent.

## Ce que la fonction fait d'un échec (depuis la correction des envois muets)

La réponse d'Expo est désormais **lue** (`_shared/expoPush.ts`). Trois conséquences :

- `sent_count` dans `admin_notifications` = les envois **acceptés par Expo**, plus le nombre
  d'appareils qu'on espérait toucher. Une ligne à `0` signale une occurrence perdue.
- **Échec total** (des appareils visés, aucun envoi accepté) → la planification n'est **pas** marquée
  comme envoyée : `last_sent_at` reste tel quel et le cron **retentera** au passage suivant. C'est ce
  qui manquait : une mensuelle « partait », échouait, et l'occurrence était perdue jusqu'au mois
  suivant. La reprise est bornée — une périodique n'est due que le bon jour, un envoi ponctuel est
  abandonné 24 h après son `trigger_at`.
- Une seule ligne d'historique par jour et par planification en cas d'échec (sinon un cron à la
  minute inonderait l'écran admin avec le même échec).

La réponse HTTP contient un tableau `failures` — visible directement dans le **journal d'exécution
de cron-job.org**, sans ouvrir Supabase :

```json
{ "ok": true, "processed": 4, "fired": 1,
  "results": [{ "id": "...", "title": "Le Point", "targeted": 11, "accepted": 11, "failed": 0 }],
  "failures": [] }
```

Un `failures` non vide, ou un `accepted` à 0 alors que `targeted` est élevé, désigne une panne
d'envoi et non un problème d'audience. Le détail par code est dans les logs de la fonction
(Supabase → Edge Functions → Logs) et dans le panneau admin « Qui est joignable ».
