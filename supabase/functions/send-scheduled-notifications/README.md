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
