/**
 * Saisie d'un MONTANT — normalisation à la frappe.
 *
 * ── LE PROBLÈME QUE ÇA RÈGLE ────────────────────────────────────────────────────────────────────
 * Les champs de montant se contentaient de retirer les caractères non numériques :
 *     onChangeText={(v) => setX(v.replace(/[^0-9.,]/g, ''))}
 * ce qui laisse passer PLUSIEURS séparateurs. Or tous les lecteurs de l'app font ensuite :
 *     parseFloat(x.replace(',', '.'))
 * — et `String.replace` avec une chaîne ne remplace que la PREMIÈRE occurrence.
 *
 * Conséquence, silencieuse : taper « 1.234,56 » (séparateur de milliers, réflexe courant) affichait
 * bien « 1.234,56 » à l'écran… et enregistrait **1,23 €**. Aucun signal, aucun garde-fou : la
 * valeur lue n'était pas celle qui était montrée.
 *
 * ── LA RÈGLE ────────────────────────────────────────────────────────────────────────────────────
 * Le champ ne peut plus AFFICHER autre chose que ce qui sera lu : au plus un séparateur décimal, au
 * plus deux décimales. Une valeur mal tapée reste visible à l'écran, donc corrigeable par
 * l'utilisateur — au lieu d'être tronquée dans son dos.
 *
 * On conserve le séparateur qu'il a tapé (virgule OU point) : il continue de voir sa convention.
 * Une fois ce filtre en place, `parseFloat(x.replace(',', '.'))` redevient exact partout.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^0-9.,]/g, '');
  const first = cleaned.search(/[.,]/);
  if (first === -1) return cleaned;
  const separator = cleaned[first];
  const head = cleaned.slice(0, first);
  const decimals = cleaned.slice(first + 1).replace(/[.,]/g, '').slice(0, 2);
  return head + separator + decimals;
}

/**
 * Variante autorisant un signe « − » en tête (champs qui acceptent un montant négatif : solde
 * relevé sur un compte à découvert, régularisation à la baisse).
 */
export function sanitizeSignedAmountInput(raw: string): string {
  const s = String(raw ?? '');
  const negative = /^\s*-/.test(s);
  const body = sanitizeAmountInput(s);
  return negative ? `-${body}` : body;
}

/**
 * Lit un montant saisi. À n'utiliser QUE sur une valeur passée par `sanitizeAmountInput` — sinon
 * la même ambiguïté qu'avant revient (plusieurs séparateurs).
 * Rend `null` quand le champ ne dit rien d'exploitable, pour que l'appelant choisisse son repli.
 */
export function parseAmountInput(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
