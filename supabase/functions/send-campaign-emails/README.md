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

## Plusieurs clés Brevo (bascule automatique)

Un compte Brevo gratuit plafonne à **~300 e-mails par jour**. Au-delà, l'API répond `402
not_enough_credits` et la campagne s'arrête au milieu. Plusieurs clés permettent de reprendre
l'envoi avec le compte suivant, sans intervention.

```bash
# Écriture SIMPLE — plusieurs clés séparées par des virgules.
supabase secrets set BREVO_API_KEYS="xkeysib-aaa...,xkeysib-bbb...,xkeysib-ccc..."
```

```bash
# Écriture DÉTAILLÉE — un expéditeur propre à chaque clé (JSON sur une ligne).
supabase secrets set BREVO_API_KEYS='[{"key":"xkeysib-aaa","sender":"contact@relyka.app","name":"Relyka"},{"key":"xkeysib-bbb","sender":"hello@relyka.app"}]'
```

> ⚠️ **Chaque clé appartient à un compte Brevo différent, et un compte ne peut expédier que depuis
> un expéditeur qu'il a lui-même vérifié.** Si la clé de secours n'a pas validé
> `contact@relyka.app`, elle sera refusée pour une raison qui n'a rien à voir avec le quota. Vérifie
> l'expéditeur dans **chaque** compte (Brevo → Expéditeurs & IP), ou donne à chaque clé le sien via
> l'écriture détaillée. Pour préserver la délivrabilité, l'idéal est que le domaine `relyka.app` soit
> authentifié (SPF/DKIM) dans chaque compte, pas seulement le premier.

`BREVO_API_KEY` (au singulier) reste accepté — c'est l'ancienne configuration, équivalente à une
liste d'une seule clé.

### Comment la bascule se déclenche

Une clé est **écartée** et la suivante prend le relais sur le **même lot** quand Brevo répond :

| Réponse | Sens |
| --- | --- |
| `402` / `not_enough_credits` | Quota journalier épuisé |
| `429` | Cadence dépassée |
| `401` / `403` | Clé invalide ou révoquée |

Toute autre erreur (contenu refusé, destinataire invalide…) **arrête** l'envoi sans rotation :
changer de compte n'y changerait rien, et réessayer enverrait des doublons.

Les lots font **100 destinataires** (et non 500) : un lot doit rester plus petit que le quota d'un
compte, sinon toutes les clés le refuseraient en bloc et rien ne partirait.

Une fois qu'une clé fonctionne, les lots suivants la réutilisent — on ne repasse pas par une clé
déjà épuisée à chaque lot.

### Si la campagne s'interrompt

Le statut passe à `failed` et le message d'erreur indique **où** ça s'est arrêté :

```
Interrompue après 300/742 destinataires. Les 3 clés Brevo ont échoué. clé #1 : HTTP 402 — ...
```

Les 300 premiers ont reçu le message : relancer la campagne telle quelle leur écrirait une seconde
fois. Attends le lendemain (les quotas se réinitialisent) ou ajoute une clé.
