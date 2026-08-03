# Gabarits d'e-mails Relyka

Deux canaux **distincts**, à ne pas confondre :

| Canal | Qui envoie | Ce qu'il envoie | Où se règle le gabarit |
|---|---|---|---|
| **Auth** | Supabase, via le **SMTP Brevo** | Confirmation d'inscription, mot de passe oublié, changement d'adresse, invitation | Dashboard Supabase (les fichiers de ce dossier) |
| **Applicatif** | Notre Edge Function, via l'**API Brevo** | Campagnes et informations (écran admin → E-mails) | En dur dans `supabase/functions/send-campaign-emails` |

## 1. Coller les gabarits d'auth

**Dashboard Supabase → Authentication → Emails → Templates.** Pour chaque onglet, coller le contenu
du fichier correspondant :

**Authentication**

| Onglet Supabase | Fichier |
|---|---|
| Confirm sign up | `confirm-signup.html` |
| Invite user | `invite.html` |
| Magic link or OTP | `magic-link.html` |
| Change email address | `change-email.html` |
| Reset password | `reset-password.html` |
| Reauthentication | `reauthentication.html` |

**Security** (à activer avec l'interrupteur de la ligne — ils sont désactivés par défaut)

| Onglet Supabase | Fichier |
|---|---|
| Password changed | `password-changed.html` |
| Email address changed | `email-changed.html` |

Objets suggérés :

- Confirm signup → `Confirme ton adresse Relyka`
- Reset password → `Réinitialise ton mot de passe Relyka`
- Magic Link → `Ton lien de connexion Relyka`
- Change Email → `Confirme ta nouvelle adresse Relyka`
- Invite → `Tu es invité sur Relyka`

Objets suggérés pour les trois derniers :

- Reauthentication → `Ton code de confirmation Relyka`
- Password changed → `Ton mot de passe Relyka a été modifié`
- Email address changed → `L'adresse de ton compte Relyka a changé`

Variables utilisées : `{{ .ConfirmationURL }}` pour les cinq premiers (le lien est aussi affiché en
clair sous le bouton — certaines messageries d'entreprise neutralisent les boutons), et
`{{ .Token }}` pour la réauthentification, qui est un **code à 6 chiffres** et non un lien.
Les deux gabarits « Security » ne portent aucune action : ce sont des notifications, pas des
demandes — leur seule utilité est d'alerter quand le changement n'est **pas** de l'utilisateur.

## 2. Réglages Supabase à vérifier

- **Authentication → Providers → Email** : activé, et *Confirm email* activé (l'adresse doit être
  vérifiée pour que la réinitialisation ait du sens).
- **Authentication → URL Configuration → Redirect URLs** : ajouter `https://relyka.app/**` et
  l'URL de développement, sinon les liens des e-mails retombent sur une page d'erreur.
- **Project Settings → Authentication → SMTP Settings** : les identifiants Brevo (déjà faits).

## 3. Secrets pour les envois applicatifs

Dashboard → **Project Settings → Edge Functions → Secrets** :

```
BREVO_API_KEY=xkeysib-…
BREVO_SENDER_EMAIL=contact@relyka.app
BREVO_SENDER_NAME=Relyka
PUBLIC_APP_URL=https://relyka.app
CRON_SECRET=<une chaîne aléatoire longue, à toi>
```

L'expéditeur doit être un **domaine vérifié dans Brevo** (SPF/DKIM), sinon tout part en spam.

## 4. Déployer la fonction et programmer le cron

```bash
supabase functions deploy send-campaign-emails
```

Le cron réveille la fonction pour envoyer les campagnes programmées. Dans le SQL Editor :

```sql
select cron.schedule(
  'send-scheduled-emails',
  '*/15 * * * *',                        -- toutes les 15 minutes
  $$ select net.http_post(
       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-campaign-emails',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
       body    := '{}'::jsonb
     ) $$
);
```

Remplacer `<PROJECT_REF>` et `<CRON_SECRET>`. Les extensions `pg_cron` et `pg_net` doivent être
activées (Database → Extensions).
