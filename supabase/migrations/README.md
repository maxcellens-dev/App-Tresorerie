# Migrations SQL

Rangées **par centaines** : `001-099/`, `100-199/`, puis `200-299/` le jour venu. À 182 fichiers,
un dossier unique n'était plus lisible.

## Elles sont appliquées À LA MAIN

Il n'y a pas de `supabase/config.toml`, aucun script ne les référence, et le nommage (`177_nom.sql`)
n'est pas la convention horodatée de la CLI Supabase (`20240101120000_nom.sql`). Ces fichiers sont
donc joués manuellement dans l'éditeur SQL, dans l'ordre des numéros.

**C'est précisément ce qui rend ce rangement sans risque** : `supabase db push` ne descend pas dans
les sous-dossiers, et l'aurait donc cassé. Si vous adoptez la CLI un jour, il faudra remettre les
fichiers à plat ET les renommer au format horodaté.

## Avant d'ajouter une migration

Prenez le numéro **suivant le plus élevé, toutes centaines confondues** — pas le dernier de son
dossier.

⚠️ **Des numéros sont déjà en double** (héritage, à ne pas reproduire) : `006`, `007`, `008`, `009`
et `072` portent chacun deux ou trois fichiers distincts. L'ordre d'application entre homonymes
n'est pas déterminé par le nom — vérifiez leur contenu avant de rejouer une base de zéro.
