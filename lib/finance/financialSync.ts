import { computeCreditSchedule, creditScheduleHash, type CreditOccurrence } from './creditMaterialization';
import type { Credit } from '../../types/database';
import type { CreditEventRow } from '../../hooks/data/useCreditEvents';

interface SyncDependencies {
  rpc: (name: string, args?: any) => PromiseLike<{ data?: any; error?: any }>;
  loadCredits: () => Promise<Credit[]>;
  loadAccounts: () => Promise<{ id: string; _role?: string }[]>;
  loadEvents: () => Promise<Record<string, CreditEventRow[]>>;
  /** Remet à vrai les drapeaux `posted` des opérations échues, une fois les soldes recalculés. */
  markPosted?: (today: string) => Promise<void>;
  schedule?: typeof computeCreditSchedule;
  skipPostedReconciliation?: boolean;
  onRecurringComplete?: () => void;
}

/** Une annulation react-query n'annule pas les RPC déjà parties : les relances les rejoignent. */
export function createFinancialSynchronizer() {
  const running = new Map<string, Promise<boolean>>();
  const recurringDone = new Map<string, string>();
  return (profileId: string, today: string, deps: SyncDependencies): Promise<boolean> => {
    const key = `${profileId}:${today}`;
    const previous = running.get(key);
    if (previous) return previous;
    const promise = synchronizeFinances(profileId, today, {
      ...deps, skipPostedReconciliation: recurringDone.get(profileId) === today,
      onRecurringComplete: () => recurringDone.set(profileId, today),
    }).finally(() => { if (running.get(key) === promise) running.delete(key); });
    running.set(key, promise);
    return promise;
  };
}

/** Lecture du Pilotage uniquement APRÈS les écritures qui peuvent modifier ses soldes. */
export async function synchronizeFinances(profileId: string, today: string, d: SyncDependencies): Promise<boolean> {
  let changed = false;
  const call = async (name: string, args: any) => {
    const result = await d.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  };
  const args = { p_profile: profileId, p_today: today };
  // Lectures seules : elles ne dépendent pas de la réconciliation des soldes.
  // La révision crédit reste lue AVANT ses événements pour détecter une édition concurrente.
  const creditRead = (async () => {
    const credits = await d.loadCredits();
    const events = credits.length ? await d.loadEvents() : {};
    return { credits, events };
  })();
  // Une erreur de réconciliation peut nous faire sortir avant d'attendre cette lecture.
  creditRead.catch(() => {});
  const [accounts, probe] = await Promise.all([
    d.loadAccounts(), d.rpc('pending_materialization', args),
  ]);
  {
    if (probe.error && !['PGRST202', '42883'].includes(probe.error.code)) throw probe.error;
    const pending = Array.isArray(probe.data) ? probe.data[0] : probe.data;
    const recurring = !!probe.error || pending?.needs_recurring !== false;
    // reconcile_posted recalcule les soldes mais les anciens drapeaux posted peuvent rester faux.
    // Ne pas réécrire tous les comptes à chaque refetch. Une récurrence nouvelle reste traitée.
    const posted = !d.skipPostedReconciliation && (!!probe.error || pending?.needs_posted !== false);
    changed = recurring || posted;
    if (recurring) await call('materialize_due_recurring', args);
    if (recurring || posted) {
      // L'ancienne RPC réécrit TOUS les comptes dans une transaction, y compris les archivés.
      // Des ouvertures concurrentes peuvent se bloquer puis dépasser le délai serveur.
      // Chaque RPC ne verrouille qu'UN compte : trois transactions courtes et indépendantes
      // peuvent avancer ensemble, sans la transaction multi-comptes qui causait des deadlocks.
      // Dédupliquer les IDs et attendre TOUTE la vague, même en cas d'erreur : une relance ne
      // doit jamais rejoindre une synchronisation déclarée finie dont des écritures continuent.
      const writableIds = [...new Set(accounts.filter(a => a._role === 'owner' || a._role === 'write').map(a => a.id))].sort();
      for (let start = 0; start < writableIds.length; start += 3) {
        const results = await Promise.allSettled(writableIds.slice(start, start + 3).map(id =>
          call('recompute_account_balance', { p_account: id, p_today: today })));
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }
      /* Sans cela la sonde répondait « needs_posted » à CHAQUE ouverture : tous les comptes
         réécrits, données déclarées changées, toute la chaîne de lectures relancée. Un échec ici
         ne fausse aucun solde (ils viennent d'être recalculés sur les dates) : on ne bloque pas. */
      if (posted && d.markPosted) await d.markPosted(today).catch(() => {});
    }
    d.onRecurringComplete?.();
  }

  // Les publications restent strictement APRÈS la réussite de toutes les réconciliations.
  const { credits, events } = await creditRead;
  const active = new Set(accounts.map(a => a.id));
  let needsCreditMaterialization = false;
  for (const c of credits) {
    if (!['owner', 'write'].includes(c._role ?? '') || !c.is_active || c.is_simulation || !c.account_id || !active.has(c.account_id)) continue;
    if (c.materialized_until == null) throw new Error('La synchronisation des crédits nécessite une mise à jour du serveur.');
    if (c.materialized_until < today) needsCreditMaterialization = true;
    const rows: CreditOccurrence[] = (d.schedule ?? computeCreditSchedule)(c, events[c.id]);
    const hash = creditScheduleHash(rows);
    if (hash === c.schedule_hash) continue;
    await call('publish_credit_schedule', {
      p_credit: c.id, p_hash: hash, p_today: today,
      p_expected_updated_at: c.updated_at, p_previous_hash: c.schedule_hash ?? null,
      p_expected_events_revision: c.events_revision ?? 0,
      p_rows: rows.map(o => ({ kind: o.credit_kind, period: o.credit_period, date: o.date, amount: o.amount, account_id: o.account_id, category_id: o.category_id, note: o.note })),
    });
    changed = true;
  }
  if (needsCreditMaterialization) changed = Number(await call('materialize_credit_from_schedule', { p_today: today })) > 0 || changed;
  return changed;
}
