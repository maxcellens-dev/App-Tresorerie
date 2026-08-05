// ============================================================================
// brevoKeys — la liste des clés Brevo utilisables, assemblée depuis les secrets.
//
// Deux secrets, qui s'ADDITIONNENT (et ne se remplacent pas) :
//   • BREVO_API_KEY   — la clé historique, telle qu'elle est déjà configurée ;
//   • BREVO_API_KEYS  — les clés SUPPLÉMENTAIRES (ou la liste complète, au choix).
//
// Pourquoi l'addition plutôt que « l'un OU l'autre » : Brevo n'affiche JAMAIS une clé après sa
// création. Exiger la liste complète dans un seul secret obligerait, pour ajouter un compte, à
// retrouver une valeur qu'on ne peut plus lire — donc à révoquer et recréer la clé du premier
// compte pour rien. Ici, on ajoute la nouvelle clé dans `BREVO_API_KEYS` et on ne touche pas à
// `BREVO_API_KEY` : rien à retrouver, rien à recréer, aucune coupure d'envoi.
//
// Écritures acceptées pour BREVO_API_KEYS :
//   • simple    : "xkeysib-bbb, xkeysib-ccc"  (virgule, point-virgule, espace ou retour ligne)
//   • détaillée : [{"key":"xkeysib-bbb","sender":"contact@relyka.app","name":"Relyka"}, …]
// L'écriture détaillée sert quand chaque compte Brevo a son propre expéditeur vérifié.
// ============================================================================

export interface BrevoKey {
  key: string;
  /** Expéditeur à utiliser avec CETTE clé (chaque compte ne peut expédier que depuis le sien). */
  sender: string;
  name: string;
}

function parseOne(raw: string, defSender: string, defName: string): BrevoKey[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .map((e: any) => ({
            key: String(e?.key ?? e ?? '').trim(),
            sender: String(e?.sender ?? defSender).trim(),
            name: String(e?.name ?? defName).trim(),
          }))
          .filter((e) => e.key);
      }
    } catch {
      // JSON invalide → on retombe sur la lecture « simple » plutôt que de perdre toutes les clés.
    }
  }
  return trimmed.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean)
    .map((key) => ({ key, sender: defSender, name: defName }));
}

/**
 * Clés Brevo, dans l'ordre d'essai : la clé historique d'abord (son expéditeur est déjà vérifié
 * depuis longtemps), puis les clés ajoutées. Dédoublonné sur la valeur de la clé — inscrire deux
 * fois la même dans les deux secrets ne crée pas deux tentatives identiques.
 */
export function brevoKeys(defSender: string, defName: string): BrevoKey[] {
  const merged = [
    ...parseOne(Deno.env.get('BREVO_API_KEY') ?? '', defSender, defName),
    ...parseOne(Deno.env.get('BREVO_API_KEYS') ?? '', defSender, defName),
  ];
  const seen = new Set<string>();
  return merged.filter((k) => (seen.has(k.key) ? false : (seen.add(k.key), true)));
}
