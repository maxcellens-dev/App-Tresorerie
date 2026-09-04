/**
 * Recalibration de la dérive de fiabilité (profiles.reliability_calib) — logique PURE et partagée.
 *
 * Appelée après CHAQUE événement qui change l'ensemble des « vérifications » (régularisations) :
 *  • ajout d'une régul / clôture confirmée (useRecalibrateReliability) ;
 *  • SUPPRESSION d'une régul (useDeleteTransaction) — sinon une régul ajoutée puis retirée laissait
 *    une dérive « figée » (souvent surestimée) → tout passait en « estimé » à tort.
 *
 * dérive_journalière = médiane(|écarts trouvés|) / médiane(jours entre vérifications).
 * Les mois « estimated » (non fiables) sont exclus. Amorçage à la 1ʳᵉ régul : l'écart s'est accumulé
 * depuis la création du profil (plafonné à coldStartDays).
 */
import { supabase } from '../platform/supabase';
import { resolveReliabilityConfig, computeCalibration } from './confidenceEngine';
import { isInitialBalanceAnchor, isWealthRegul } from './regul';
import { todayISO } from '../dateUtils';

/** Recalcule et PERSISTE profiles.reliability_calib depuis les régularisations restantes. */
export async function recomputeReliabilityCalibration(profileId: string): Promise<void> {
  if (!supabase || !profileId) return;
  /* Les régularisations, avec leur NATURE (`regul_kind`, migration 223) : une mise à jour de solde
     d'ÉPARGNE n'est pas un écart constaté sur le quotidien. Relever son livret et y trouver 3 000 €
     de plus ne dit rien de ce qui a échappé à la saisie sur le compte courant — c'est de l'argent
     mis de côté sans le noter. Les compter ici fait exploser la dérive journalière, donc le doute
     affiché sur TOUS les montants de l'app (même mécanique que les ancres de solde initial).

     ⚠️ REPLI SI LA COLONNE N'EXISTE PAS ENCORE. Une mise à jour applicative (OTA) peut atteindre une
     installation dont la base n'a pas encore reçu la migration : la requête échouerait alors en
     entier, `data` vaudrait `null`, et on écrirait une calibration calculée sur ZÉRO vérification —
     c'est-à-dire qu'on effacerait silencieusement la fiabilité de l'utilisateur. On refait donc la
     lecture sans la colonne, et le comportement d'avant reprend jusqu'à la migration. */
  const readReguls = async (withKind: boolean) =>
    supabase!.from('transactions')
      .select(withKind ? 'date, amount, regul_target, note, regul_kind' : 'date, amount, regul_target, note')
      .eq('profile_id', profileId)
      .not('regul_target', 'is', null)
      .lte('date', todayISO())
      .order('date', { ascending: true });

  const [txResFirst, clRes, cfgRes, profRes] = await Promise.all([
    readReguls(true),
    supabase.from('month_closures').select('month_key, status').eq('profile_id', profileId),
    supabase.from('app_config').select('reliability').eq('id', 'default').single(),
    supabase.from('profiles').select('created_at').eq('id', profileId).single(),
  ]);
  const txRes = txResFirst.error ? await readReguls(false) : txResFirst;
  /* Lecture toujours en échec → on NE RÉÉCRIT RIEN. Une erreur de lecture n'est pas « il n'y a
     aucune régularisation » : la prendre pour telle remettrait la dérive à sa valeur d'amorçage. */
  if (txRes.error) return;
  const cfg = resolveReliabilityConfig((cfgRes.data as any)?.reliability ?? null);
  const estimated = new Set(
    ((clRes.data ?? []) as any[]).filter((c) => c.status === 'estimated').map((c) => c.month_key),
  );
  // Une « vérification » = un JOUR de régul (multi-comptes le même jour → écarts sommés).
  //
  // ⚠️ Les ANCRES DE SOLDE INITIAL sont exclues : ce ne sont pas des écarts constatés mais le point
  // de départ d'un compte. Les compter revenait à dire « on a perdu de vue 50 000 € », d'où une
  // dérive journalière absurde et un Relyka affiché en fourchette gigantesque. Le problème est
  // devenu systématique depuis que le démarrage crée plusieurs comptes soldés d'un coup.
  const byDay = new Map<string, number>();
  for (const t of (txRes.data ?? []) as any[]) {
    if (isInitialBalanceAnchor(t)) continue;
    if (isWealthRegul(t)) continue; // épargne / investissement : un mouvement, pas un écart constaté
    const d = String(t.date).slice(0, 10);
    if (estimated.has(d.slice(0, 7))) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + Math.abs(Number(t.amount)));
  }
  const days = [...byDay.keys()].sort();
  const samples: { absGap: number; daysBetween: number }[] = [];
  for (let i = 1; i < days.length; i++) {
    const gapDays = Math.round((new Date(days[i] + 'T00:00:00').getTime() - new Date(days[i - 1] + 'T00:00:00').getTime()) / 86400000);
    samples.push({ absGap: byDay.get(days[i])!, daysBetween: gapDays });
  }
  if (samples.length === 0 && days.length > 0) {
    // Amorçage 1ʳᵉ régul : l'écart s'est accumulé depuis la création du profil.
    const lastDay = days[days.length - 1];
    const createdAt = String((profRes.data as any)?.created_at ?? '').slice(0, 10);
    let span = cfg.coldStartDays;
    if (createdAt) {
      const d = Math.round((new Date(lastDay + 'T00:00:00').getTime() - new Date(createdAt + 'T00:00:00').getTime()) / 86400000);
      if (Number.isFinite(d)) span = Math.min(Math.max(1, d), cfg.coldStartDays);
    }
    samples.push({ absGap: byDay.get(lastDay)!, daysBetween: span });
  }
  const calib = computeCalibration(samples);
  await supabase.from('profiles').update({ reliability_calib: calib }).eq('id', profileId);
}
