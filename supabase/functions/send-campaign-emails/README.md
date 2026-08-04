# Edge Function — send-campaign-emails

Envoie les campagnes e-mail (écran admin → Campagnes) via Brevo. Deux appelants :

- **Admin** : `POST { campaign_id }` avec le JWT de l'admin → envoi immédiat.
- **Cron** : secret partagé `CRON_SECRET` → envoie toutes les campagnes `scheduled` dont
  `scheduled_at` est passée.

## Déploiement

```bash
supabase secrets set CRON_SECRET=<le-meme-secret-que-les-autres-crons>

# SANS vérif JWT : le cron s'authentifie par CRON_SECRET, pas par un JWT.
supabase functions deploy send-campaign-emails --no-verify-jwt
```

> ⚠️ **C'est le point qui casse le cron.** Déployée normalement (vérif JWT active, le défaut), la
> passerelle Supabase renvoie **401 avant même d'exécuter la fonction** : `Bearer <CRON_SECRET>`
> n'est pas un JWT valide. L'appel admin reste protégé sans la vérif JWT : la fonction revalide
> elle-même l'utilisateur (`auth.getUser()`) **et** son statut admin (`is_app_admin()`).

Les autres crons du projet (`send-scheduled-notifications`, `refresh-currency-rates`) sont déjà
déployés ainsi — d'où le fait que la même clé y fonctionne.

## Cron (cron-job.org)

- **URL** : `https://<PROJECT_REF>.supabase.co/functions/v1/send-campaign-emails`
- **Méthode** : GET ou POST (les deux passent pour l'appel cron)
- **Planning** : toutes les 5 min suffit (précision de l'heure d'envoi programmée)
- **En-tête** (onglet *Avancé* → *Headers*) : `Authorization: Bearer <CRON_SECRET>`
  (ou `X-Cron-Secret: <CRON_SECRET>`)
- Ne pas oublier **« Activer tâche »**.

## Réponse

```json
{ "ok": true, "campaigns": 1, "sent": 342, "errors": [] }
```
