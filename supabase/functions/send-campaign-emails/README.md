# Edge Function — send-campaign-emails

Envoie les campagnes e-mail (écran admin → Campagnes) via Brevo. Deux appelants :

- **Admin** : `POST { campaign_id }` avec le JWT de l'admin → envoi immédiat.
- **Cron** : secret partagé `CRON_SECRET` → à chaque passage :
  1. engendre une occurrence pour chaque **envoi récurrent** dû (migration 169) ;
  2. envoie les campagnes `scheduled` dont `scheduled_at` est passée ;
  3. reprend les campagnes `paused` dont `resume_at` est atteint (migration 168).

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
{ "ok": true, "campaigns": 1, "sent": 300, "paused": 1, "errors": [] }
```

`paused` > 0 = une campagne a atteint le quota du jour et reprendra toute seule (voir plus bas).

## Plusieurs clés Brevo (bascule automatique)

Un compte Brevo gratuit plafonne à **~300 e-mails par jour**. Au-delà, l'API répond `402
not_enough_credits` et la campagne s'arrête au milieu. Plusieurs clés permettent de reprendre
l'envoi avec le compte suivant, sans intervention.

### Ajouter un compte — ce qu'il ne faut PAS faire

**Ne touche pas à `BREVO_API_KEY`.** Brevo ne réaffiche jamais une clé après sa création : si tu
écrases ce secret, tu perds une valeur que tu ne peux plus relire, et il faudrait révoquer puis
recréer la clé du premier compte pour rien.

Les deux secrets **s'additionnent** (cf. `_shared/brevoKeys.ts`) :

| Secret | Contenu | Quand y toucher |
| --- | --- | --- |
| `BREVO_API_KEY` | La clé historique, déjà en place | Jamais — on la laisse telle quelle |
| `BREVO_API_KEYS` | Les clés **supplémentaires** | À chaque nouveau compte |

Donc pour ajouter un 2ᵉ compte, tu ne copies **que la nouvelle clé** :

```bash
# La clé du compte 1 reste dans BREVO_API_KEY et continue d'être utilisée en premier.
supabase secrets set BREVO_API_KEYS="xkeysib-la-nouvelle-cle"
```

Pour un 3ᵉ compte plus tard, `BREVO_API_KEYS` doit contenir la 2ᵉ **et** la 3ᵉ (ce secret-là, tu en
connais le contenu puisque tu l'as écrit) :

```bash
supabase secrets set BREVO_API_KEYS="xkeysib-cle-2,xkeysib-cle-3"
```

Ordre d'essai : `BREVO_API_KEY` d'abord, puis `BREVO_API_KEYS` dans l'ordre écrit. Les doublons sont
ignorés — inscrire deux fois la même clé ne crée pas deux tentatives.

```bash
# Écriture DÉTAILLÉE — un expéditeur propre à chaque clé (JSON sur une ligne).
# Utile seulement si les comptes n'ont pas le même expéditeur vérifié.
supabase secrets set BREVO_API_KEYS='[{"key":"xkeysib-bbb","sender":"hello@relyka.app","name":"Relyka"}]'
```

> ⚠️ **Chaque clé appartient à un compte Brevo différent, et un compte ne peut expédier que depuis
> un expéditeur qu'il a lui-même vérifié.** Si la clé de secours n'a pas validé
> `contact@relyka.app`, elle sera refusée pour une raison qui n'a rien à voir avec le quota. Vérifie
> l'expéditeur dans **chaque** compte (Brevo → Expéditeurs & IP). Pour préserver la délivrabilité,
> l'idéal est que le domaine `relyka.app` soit authentifié (SPF/DKIM) dans chaque compte, pas
> seulement le premier.

### Vérifier que les deux clés sont bien prises en compte

Le panneau **Admin → E-mails → Diagnostic** affiche « E-mails dispo aujourd'hui » : c'est la **somme
des quotas** de toutes les clés reconnues. Si tu as deux comptes gratuits neufs et que la tuile
affiche ~600 au lieu de ~300, la seconde clé est bien active. Le détail **clé par clé** y figure
aussi — c'est ce qui distingue une clé *épuisée* d'une clé *refusée*.

`supabase secrets list` ne montre que le nom et une empreinte, jamais la valeur — normal.

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

Deux cas, à ne pas confondre :

| Statut | Sens | Que faire |
| --- | --- | --- |
| `paused` | Toutes les clés sont à sec — **quota**. | Rien : elle reprend seule (section suivante). |
| `failed` | Erreur qui n'a rien à voir avec le quota (contenu refusé, expéditeur non vérifié…). | Corriger, puis relancer. |

Un `failed` porte le détail, y compris l'avancement s'il y en a un. Les destinataires déjà servis
sont inscrits au registre : relancer après correction ne leur réécrira pas.

## Campagne plus grosse que le quota : elle s'étale toute seule

Une campagne à 600 personnes sur un compte plafonné à 300/jour ne peut pas partir d'un coup. Elle
n'échoue plus pour autant (migration 168) :

1. elle sert autant de destinataires que le quota le permet ;
2. quand **toutes** les clés refusent un lot, elle passe en **`paused`** — pas en `failed` ;
3. le cron la reprend automatiquement (`resume_at`, une heure plus tard) et continue **là où elle
   s'est arrêtée** ;
4. dès que le quota est revenu, elle finit et passe en `sent`.

L'écran admin affiche l'avancement : *« En pause · 300/612 envoyés · reprise 06/08/2026 09:14 »*.

### Pourquoi un registre et pas un compteur

La reprise s'appuie sur la table **`email_campaign_sends`** (une ligne par destinataire servi), et non
sur un indice de position. Entre deux jours, des comptes se créent et d'autres se désinscrivent :
« repartir du 300ᵉ » sauterait des gens ou en servirait deux fois. Le registre répond exactement à la
bonne question — *qui n'a pas encore reçu ?* — quoi qu'il arrive entre les deux passages.

Le registre est écrit **après** l'acceptation du lot par Brevo. Dans l'autre sens, un plantage entre
les deux ferait passer des destinataires pour servis alors qu'ils n'ont rien reçu, et ils seraient
définitivement sautés. Le pire cas retenu est donc un doublon sur un lot, jamais un oubli.

> ⚠️ Ne supprime pas une campagne en pause : la suppression emporte son registre (`ON DELETE
> CASCADE`), donc la garantie anti-doublon. C'est pour ça que la corbeille est masquée sur cet état.

### Reprendre plus vite

Le délai de reprise est d'**une heure** (`RESUME_DELAY_MS`). On ne sait pas à quelle heure exacte
Brevo remet les compteurs à zéro : un essai horaire coûte un appel d'API et se corrige tout seul,
alors qu'un rendez-vous à minuit raté ferait perdre une journée entière.

## Envois RÉCURRENTS (migration 169)

Une newsletter mensuelle, un conseil hebdomadaire : `email_schedules` reprend le vocabulaire des
notifications planifiées (quotidien / hebdomadaire / mensuel, heure locale, fuseau,
`day_of_month = 0` = dernier jour du mois). La logique « c'est dû maintenant ? » est **partagée**
avec `send-scheduled-notifications` (`_shared/recurrence.ts`) plutôt que recopiée.

### Une planification n'envoie jamais elle-même

À chaque échéance, le cron **crée une campagne neuve** (`email_campaigns.schedule_id` pointe vers la
planification), puis l'envoie comme n'importe quelle campagne.

C'est ce détour qui rend la chose correcte : une campagne porte son **registre d'envois**
(`email_campaign_sends`), qui empêche d'écrire deux fois au même destinataire. Rendre une campagne
récurrente rendrait ce registre absurde — dès la 2ᵉ occurrence, tout le monde y figurerait déjà et
**plus personne ne recevrait rien**. Une occurrence neuve = un registre vierge, une reprise sur quota
propre, une ligne d'historique par envoi.

`last_sent_at` est posé **avant** l'envoi : si celui-ci échoue, l'occurrence existe déjà et sera
reprise par les mécanismes de la migration 168. L'inverse risquerait de recréer une occurrence à la
minute suivante et d'écrire deux fois à tout le monde.

### Réponse du cron

```json
{ "ok": true, "campaigns": 1, "spawned": 1, "sent": 300, "paused": 1, "errors": [] }
```

`spawned` = occurrences créées par des planifications récurrentes lors de ce passage.
