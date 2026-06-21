# refresh-currency-rates

Met à jour `currency_rates` 1×/jour depuis frankfurter.app. Déclenchée par **cron-job.org**.

## Déploiement (une fois)

```bash
# 1. Se connecter (ouvre le navigateur) et lier le projet
npx supabase login
npx supabase link --project-ref <PROJECT_REF>     # ex: abcd1234efgh5678

# 2. Définir le secret partagé (remplace par une longue chaîne aléatoire)
npx supabase secrets set CRON_SECRET=<UN_SECRET_LONG_ALEATOIRE>

# 3. Déployer SANS vérification JWT (cron-job.org n'envoie pas de JWT Supabase)
npx supabase functions deploy refresh-currency-rates --no-verify-jwt
```

URL de la fonction :
`https://<PROJECT_REF>.supabase.co/functions/v1/refresh-currency-rates`

## Test manuel

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/refresh-currency-rates" \
  -H "Authorization: Bearer <UN_SECRET_LONG_ALEATOIRE>"
# → {"ok":true,"updated":33,"date":"2026-..."}
```

## cron-job.org

- URL : l'URL de la fonction ci-dessus
- Méthode : POST
- Header : `Authorization: Bearer <UN_SECRET_LONG_ALEATOIRE>`
- Planning : 1×/jour (ex. 06:00)

SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement par Supabase (ne pas les définir).
