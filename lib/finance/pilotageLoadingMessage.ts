export function pilotageLoadingMessage(error: unknown, offline = false): string {
  const e = error as { code?: string; message?: string } | null;
  const message = e?.message ?? String(error ?? '');
  if (offline) return 'Pas de connexion. Ton Relyka se mettra à jour dès son retour.';
  if (e?.code === '40P01' || e?.code === '57014' || /deadlock|statement timeout|Network timeout/i.test(message)) {
    return 'La mise à jour prend plus de temps que prévu. Réessaie dans un instant.';
  }
  if (['PGRST202', '42883', '42703'].includes(e?.code ?? '') || /mise à jour du serveur/i.test(message)) {
    return 'Une mise à jour du service est nécessaire. Ton Relyka sera disponible dès qu’elle sera terminée.';
  }
  if (/network|fetch failed|offline/i.test(message)) return 'Connexion interrompue. Réessaie pour actualiser ton Relyka.';
  return 'Tes données n’ont pas pu être actualisées. Réessaie dans un instant.';
}
