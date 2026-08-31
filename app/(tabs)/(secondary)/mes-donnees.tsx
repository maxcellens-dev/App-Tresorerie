import { useMemo, useState } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Share, ActivityIndicator } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/data/useProfile';
import { useAllAccounts } from '../../../hooks/data/useAccounts';
import { useCurrencyRates } from '../../../hooks/data/useCurrencyRates';
import { useQuestionnaireAnswers } from '../../../hooks/pilotage/useFinancialProfile';
import { currencySymbolFor, convertAmount } from '../../../lib/finance/currency';
import { todayISO } from '../../../lib/dateUtils';
import { supabase } from '../../../lib/platform/supabase';
import { effectiveSharedMode } from '../../../lib/finance/perimeter';


const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Courant', savings: 'Épargne', investment: 'Investissement', other: 'Autre',
};

const PROFILE_LABELS: Record<string, string> = {
  economiser: 'Économiser', suivi: 'Suivi', optimiser: 'Optimiser', investir: 'Investir',
};

// Libellés des questions (ordre d'affichage du questionnaire).
const QUESTION_LABELS: { key: string; label: string }[] = [
  { key: 'q1', label: 'Type de revenu' },
  { key: 'q2', label: 'Fréquence de versement des revenus' },
  { key: 'q3', label: 'Revenus nets mensuels moyens' },
  { key: 'q9', label: 'Dépenses variables hebdomadaires (€)' },
  { key: 'q4', label: 'Reste une fois les dépenses passées' },
  { key: 'q5', label: 'Autonomie de l\'épargne si revenus stoppés' },
  { key: 'q6', label: 'Part des revenus épargnée chaque mois' },
  { key: 'q7', label: 'Objectif prioritaire' },
  { key: 'q8', label: 'Montant minimum à conserver (marge de sécurité)' },
];

type Cell = string | { amount: number };
type Row = { type: 'title' | 'subtitle' | 'spacer' | 'section' | 'colhead' | 'data' | 'total'; cells: Cell[] };

/** Échappe une valeur pour le format CSV (séparateur ;). */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(';');
}
function fmtAmount(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

export default withDeferredMount(MesDonneesScreen);
function MesDonneesScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { data: profile, isLoading: pLoading } = useProfile(user?.id);
  const { data: accounts = [], isLoading: aLoading } = useAllAccounts(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /** L'export a échoué : on le DIT (il ne partait qu'en console). */
  const [error, setError] = useState<string | null>(null);

  /* ── CONSULTATION D'UN AUTRE COMPTE ──────────────────────────────────────────────────────────
     `user` est l'utilisateur EFFECTIF : en « connecté en tant que », ce bouton fabriquerait un
     fichier contenant TOUTES les données financières de la personne visitée et le déposerait sur
     l'appareil de l'administrateur. La portabilité RGPD appartient au titulaire du compte. */
  const readOnly = isImpersonating;

  /* ── MULTI-DEVISES ───────────────────────────────────────────────────────────────────────────
     Chaque compte garde sa devise native ; les TOTAUX se lisent dans la devise de référence
     (profiles.currency_code), exactement comme la page Comptes. Le total de l'export additionnait
     des soldes bruts, toutes devises confondues : « 3 200 » pouvait mélanger des euros et des
     yens, sans que le fichier ne dise jamais dans quelle devise était chaque compte. */
  const refCode = profile?.currency_code ?? 'EUR';
  const refSymbol = currencySymbolFor(refCode);
  const toRef = (v: number, cur?: string | null): number | null =>
    convertAmount(v, cur || 'EUR', refCode, rates);
  const mixedCurrencies = useMemo(
    () => new Set(accounts.map((a: any) => a.currency || 'EUR')).size > 1,
    [accounts],
  );
  /** Total converti. `null` si un taux manque : mieux vaut « ? » qu'un nombre faux. */
  const totalBalance = useMemo(() => {
    let sum = 0;
    for (const a of accounts as any[]) {
      const raw = Number(a.balance);
      if (!Number.isFinite(raw)) continue;
      const conv = toRef(raw, a.currency);
      if (conv == null) return null;
      sum += conv;
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, refCode, rates]);

  /** Export RGPD EXHAUSTIF : toutes les données personnelles sont récupérées AU MOMENT de l'export
   *  (comptes perso + partagés/joints, membres, transactions, crédits, projets, clôtures,
   *  réservations, cumuls, échéances modifiées, gamification).
   *
   *  ⚠️ UNE LECTURE EN ÉCHEC N'EST PAS « AUCUNE DONNÉE ». Chaque résultat était lu en `?? []` :
   *  une seule requête refusée (réseau, jeton expiré) produisait un fichier qui annonçait
   *  « TRANSACTIONS (0) » — un export RGPD amputé, présenté comme complet. On lève. */
  const fetchAllData = async () => {
    if (!supabase || !user?.id) return null;
    const uid = user.id;
    const [tx, members, credits, creditEvents, projects, objectives, closures, reservations, preSavings, overrides, gami, badges] = await Promise.all([
      supabase.from('transactions').select('date, amount, note, is_draft, is_recurring, recurrence_rule, recurrence_end_date, regul_target, account:accounts!account_id(name), category:categories!category_id(name), linked_account:accounts!linked_account_id(name)').eq('profile_id', uid).order('date', { ascending: false }),
      supabase.from('account_members').select('account_id, display_name, role, impact_pct, shared_mode').in('account_id', accounts.filter((a: any) => a._role === 'owner').map((a) => a.id)),
      supabase.from('credits').select('*').eq('profile_id', uid),
      supabase.from('credit_events').select('*').eq('profile_id', uid),
      supabase.from('projects').select('name, target_amount, monthly_allocation, allocation_type, target_date, status').eq('profile_id', uid),
      // La page « Objectifs » a été retirée de l'app, mais la table garde les lignes des comptes qui
      // en avaient créé : un export RGPD se doit de les restituer tant qu'elles existent.
      supabase.from('objectives').select('name, target_yearly_amount, status').eq('profile_id', uid),
      supabase.from('month_closures').select('month_key, status, surplus, closed_at').eq('profile_id', uid).order('month_key'),
      supabase.from('reservations').select('*').eq('profile_id', uid),
      supabase.from('pre_savings').select('*').eq('profile_id', uid),
      supabase.from('transaction_month_overrides').select('year, month, override_amount, override_date').eq('profile_id', uid),
      supabase.from('user_gamification').select('*').eq('profile_id', uid).maybeSingle(),
      supabase.from('user_badges').select('badge_key, unlocked_at').eq('profile_id', uid),
    ]);
    const parts = { tx, members, credits, creditEvents, projects, objectives, closures, reservations, preSavings, overrides, gami, badges };
    for (const [name, res] of Object.entries(parts)) {
      if ((res as any)?.error) {
        throw new Error(`Certaines de tes données n'ont pas pu être lues (${name}). L'export a été interrompu pour ne pas te livrer un fichier incomplet.`);
      }
    }
    return {
      tx: tx.data ?? [], members: members.data ?? [], credits: credits.data ?? [], creditEvents: creditEvents.data ?? [],
      projects: projects.data ?? [], objectives: objectives.data ?? [], closures: closures.data ?? [],
      reservations: reservations.data ?? [], preSavings: preSavings.data ?? [], overrides: overrides.data ?? [],
      gami: gami.data ?? null, badges: badges.data ?? [],
    };
  };

  // Construit les lignes structurées (réutilisées pour le .xlsx et le repli .csv).
  const buildRows = (d: NonNullable<Awaited<ReturnType<typeof fetchAllData>>>): Row[] => {
    const now = new Date();
    const rows: Row[] = [];
    const acctName = new Map(accounts.map((a) => [a.id, a.name]));
    rows.push({ type: 'title', cells: ['Mes données Relyka'] });
    rows.push({ type: 'subtitle', cells: ['Exporté le ' + now.toLocaleString('fr-FR')] });
    rows.push({ type: 'spacer', cells: [''] });

    rows.push({ type: 'section', cells: ['PROFIL'] });
    rows.push({ type: 'colhead', cells: ['Champ', 'Valeur'] });
    rows.push({ type: 'data', cells: ['Nom', profile?.full_name ?? ''] });
    rows.push({ type: 'data', cells: ['Email', profile?.email ?? user?.email ?? ''] });
    rows.push({ type: 'data', cells: ['Profil financier', PROFILE_LABELS[(profile as any)?.financial_profile] ?? (profile as any)?.financial_profile ?? ''] });
    rows.push({ type: 'data', cells: ['Marge de sécurité (' + refSymbol + ')', { amount: Number(profile?.safety_margin_amount ?? 0) }] });
    rows.push({ type: 'data', cells: ['Devise de référence', refCode] });
    rows.push({ type: 'data', cells: ['Allocation épargne (%)', { amount: Number((profile as any)?.allocation_save_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation investissement (%)', { amount: Number((profile as any)?.allocation_invest_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation plaisir (%)', { amount: Number((profile as any)?.allocation_enjoy_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation conserver (%)', { amount: Number((profile as any)?.allocation_keep_percent ?? 0) }] });
    rows.push({ type: 'spacer', cells: [''] });

    /* COMPTES : perso + joints + reçus (rôle), avec ma part (%), le mode « périmètre quotidien » et
       — c'est nouveau — la DEVISE de chaque compte. Le solde reste dans sa devise native (c'est le
       montant réel du compte) ; seul le TOTAL est converti dans la devise de référence, et il est
       marqué « ≈ » dès que plusieurs devises sont en jeu. Sans cela, la colonne « Solde » mêlait
       des devises sans le dire, et le total les additionnait comme si elles étaient identiques. */
    rows.push({ type: 'section', cells: ['COMPTES (personnels, joints & partagés)'] });
    rows.push({ type: 'colhead', cells: ['Nom', 'Type · Partage · Part · Mode', 'Solde (devise du compte)'] });
    accounts.forEach((a: any) => {
      const share = a.is_joint ? 'Joint' : a._role === 'owner' ? 'Perso' : a._role === 'read' ? 'Reçu (consultation)' : 'Reçu (écriture)';
      const pct = a._impact_pct != null ? ` · ${a._impact_pct} %` : '';
      const mode = (a.is_joint || a._role !== 'owner')
        ? ` · ${effectiveSharedMode(a.shared_mode) === 'contribution' ? 'Contribution' : 'Suivi quotidien'}`
        : '';
      const cur = a.currency || 'EUR';
      rows.push({ type: 'data', cells: [`${a.name} (${cur})`, `${ACCOUNT_TYPE_LABELS[a.type] ?? a.type} · ${share}${pct}${mode}`, { amount: Number(a.balance) }] });
    });
    const totalLabel = `TOTAL${mixedCurrencies ? ' ≈' : ''} (${refCode})`;
    rows.push({
      type: 'total',
      cells: ['', totalLabel, totalBalance == null ? 'taux de conversion indisponible' : { amount: totalBalance }],
    });
    rows.push({ type: 'spacer', cells: [''] });

    if (d.members.length > 0) {
      rows.push({ type: 'section', cells: ['MEMBRES DE MES COMPTES PARTAGÉS'] });
      rows.push({ type: 'colhead', cells: ['Compte', 'Membre', 'Rôle · Part'] });
      d.members.forEach((m: any) => {
        rows.push({ type: 'data', cells: [acctName.get(m.account_id) ?? m.account_id, m.display_name, `${m.role}${m.impact_pct != null ? ` · ${m.impact_pct} %` : ''}`] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    rows.push({ type: 'section', cells: [`TRANSACTIONS (${d.tx.length})`] });
    // Une transaction est dans la devise de SON compte (cf. migration 087) : l'en-tête ne peut donc
    // pas afficher un symbole unique sans mentir dès qu'un compte est dans une autre devise.
    rows.push({ type: 'colhead', cells: ['Date · Compte · Libellé', 'Catégorie · Récurrence', 'Montant (devise du compte)'] });
    d.tx.forEach((t: any) => {
      const rec = t.is_recurring ? ` · récurrent (${t.recurrence_rule ?? ''})` : '';
      const draft = t.is_draft ? ' · brouillon' : '';
      const virement = t.linked_account?.name ? ` → ${t.linked_account.name}` : '';
      rows.push({
        type: 'data',
        cells: [`${t.date} · ${t.account?.name ?? ''} · ${t.note ?? t.category?.name ?? ''}${virement}`, `${t.category?.name ?? (t.regul_target != null ? 'Régularisation' : t.linked_account?.name ? 'Virement' : '')}${rec}${draft}`, { amount: Number(t.amount) }],
      });
    });
    rows.push({ type: 'spacer', cells: [''] });

    if (d.overrides.length > 0) {
      rows.push({ type: 'section', cells: ['ÉCHÉANCES MODIFIÉES'] });
      rows.push({ type: 'colhead', cells: ['Mois', 'Nouvelle date', 'Montant modifié'] });
      d.overrides.forEach((o: any) => {
        rows.push({ type: 'data', cells: [`${o.year}-${String(o.month).padStart(2, '0')}`, o.override_date ?? '—', o.override_amount != null ? { amount: Number(o.override_amount) } : '—'] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    if (d.projects.length > 0 || d.objectives.length > 0) {
      rows.push({ type: 'section', cells: ['PROJETS & OBJECTIFS'] });
      rows.push({ type: 'colhead', cells: ['Nom', 'Détail', 'Montant (' + refSymbol + ')'] });
      d.projects.forEach((p: any) => {
        rows.push({ type: 'data', cells: [p.name, `Projet · ${p.status}${p.target_date ? ` · échéance ${p.target_date}` : ''} · ${Number(p.monthly_allocation ?? 0)} €/mois`, { amount: Number(p.target_amount ?? 0) }] });
      });
      d.objectives.forEach((o: any) => {
        rows.push({ type: 'data', cells: [o.name, `Objectif annuel · ${o.status}`, { amount: Number(o.target_yearly_amount ?? 0) }] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    if (d.credits.length > 0) {
      rows.push({ type: 'section', cells: ['CRÉDITS'] });
      rows.push({ type: 'colhead', cells: ['Libellé', 'Détail complet (JSON)'] });
      d.credits.forEach((c: any) => {
        const { id: _i, profile_id: _p, ...rest } = c;
        rows.push({ type: 'data', cells: [c.label ?? c.type ?? 'Crédit', JSON.stringify(rest)] });
      });
      d.creditEvents.forEach((e: any) => {
        const { id: _i, profile_id: _p, credit_id: _c, ...rest } = e;
        rows.push({ type: 'data', cells: ['— événement', JSON.stringify(rest)] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    if (d.closures.length > 0) {
      rows.push({ type: 'section', cells: ['CLÔTURES MENSUELLES'] });
      rows.push({ type: 'colhead', cells: ['Mois', 'Statut', 'Surplus (' + refSymbol + ')'] });
      d.closures.forEach((cl: any) => {
        rows.push({ type: 'data', cells: [cl.month_key, cl.status === 'estimated' ? 'Estimé' : 'Confirmé', { amount: Number(cl.surplus ?? 0) }] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    if (d.reservations.length > 0 || d.preSavings.length > 0) {
      rows.push({ type: 'section', cells: ['RÉSERVATIONS & CUMULS'] });
      rows.push({ type: 'colhead', cells: ['Libellé', 'Type', 'Montant (' + refSymbol + ')'] });
      d.reservations.forEach((r: any) => {
        rows.push({ type: 'data', cells: [r.libelle ?? 'Réservation', `Réservé · ${String(r.created_at ?? '').slice(0, 10)}`, { amount: Number(r.montant ?? 0) }] });
      });
      d.preSavings.forEach((p: any) => {
        rows.push({ type: 'data', cells: [p.type === 'invest' ? 'Cumul investissement' : 'Cumul épargne', `Statut : ${p.statut ?? ''}`, { amount: Number(p.total_cumule ?? 0) }] });
      });
      rows.push({ type: 'spacer', cells: [''] });
    }

    rows.push({ type: 'section', cells: ['GAMIFICATION'] });
    rows.push({ type: 'colhead', cells: ['Champ', 'Valeur'] });
    rows.push({ type: 'data', cells: ['Relyks', String(d.gami?.gems ?? 0)] });
    rows.push({ type: 'data', cells: ['Relyks gagnés au total', String(d.gami?.gems_earned_total ?? 0)] });
    rows.push({ type: 'data', cells: ['Semaines connectées', String(d.gami?.streak ?? 0)] });
    d.badges.forEach((b: any) => {
      rows.push({ type: 'data', cells: [`Succès : ${b.badge_key}`, `débloqué le ${String(b.unlocked_at ?? '').slice(0, 10)}`] });
    });
    rows.push({ type: 'spacer', cells: [''] });

    rows.push({ type: 'section', cells: ['QUESTIONNAIRE (à date)'] });
    rows.push({ type: 'colhead', cells: ['Question', 'Réponse'] });
    QUESTION_LABELS.forEach(({ key, label }) => {
      const val = (answers as any)?.[key];
      rows.push({ type: 'data', cells: [label, val == null || val === '' ? '—' : String(val)] });
    });
    return rows;
  };

  const csvFrom = (rows: Row[]): string =>
    rows.map((r) => r.type === 'spacer' ? '' : csvRow(r.cells.map((c) => typeof c === 'object' ? fmtAmount(c.amount) : c))).join('\r\n');

  const exportXlsx = async (rows: Row[], filename: string) => {
    const mod: any = await import('xlsx-js-style');
    const XLSX = mod.default ?? mod;
    const aoa = rows.map((r) => r.cells.map((c) => (typeof c === 'object' ? c.amount : c)));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 40 }, { wch: 38 }, { wch: 16 }];
    ws['!merges'] = rows.reduce((acc: any[], r, i) => {
      if (r.type === 'title' || r.type === 'subtitle' || r.type === 'section') acc.push({ s: { r: i, c: 0 }, e: { r: i, c: 2 } });
      return acc;
    }, []);
    ws['!rows'] = rows.map((r) => (r.type === 'title' ? { hpt: 24 } : r.type === 'section' ? { hpt: 20 } : { hpt: 16 }));

    const border = {
      top: { style: 'thin', color: { rgb: 'E2E6EA' } }, bottom: { style: 'thin', color: { rgb: 'E2E6EA' } },
      left: { style: 'thin', color: { rgb: 'E2E6EA' } }, right: { style: 'thin', color: { rgb: 'E2E6EA' } },
    };
    rows.forEach((r, i) => {
      if (r.type === 'spacer') return;
      r.cells.forEach((c, ci) => {
        const ref = XLSX.utils.encode_cell({ r: i, c: ci });
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        const isAmount = typeof c === 'object';
        let s: any;
        if (r.type === 'title') s = { font: { bold: true, sz: 16, color: { rgb: '0B5345' } }, alignment: { vertical: 'center' } };
        else if (r.type === 'subtitle') s = { font: { italic: true, sz: 10, color: { rgb: '6C757D' } } };
        else if (r.type === 'section') s = { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '00B67A' } }, alignment: { vertical: 'center' } };
        else if (r.type === 'colhead') s = { font: { bold: true, color: { rgb: '0B5345' } }, fill: { patternType: 'solid', fgColor: { rgb: 'D8F3E6' } }, border, alignment: { vertical: 'center' } };
        else if (r.type === 'total') s = { font: { bold: true }, border, alignment: { vertical: 'center', horizontal: isAmount ? 'right' : 'left' }, ...(isAmount ? { numFmt: '#,##0.00' } : {}) };
        else s = { border, alignment: { vertical: 'center', horizontal: isAmount ? 'right' : 'left', wrapText: true }, ...(isAmount ? { numFmt: '#,##0.00' } : {}) };
        ws[ref].s = s;
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mes données');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* L'échec ne partait QU'EN CONSOLE : le rouage tournait, s'arrêtait, et il ne se passait rien —
     pas de fichier, pas de message. Sur un export de données personnelles, c'est le pire des cas :
     on croit que ses données ont été refusées, ou pire, qu'elles n'existent plus. */
  const handleExport = async () => {
    if (readOnly || busy) return;
    setBusy(true); setDone(false); setError(null);
    try {
      const data = await fetchAllData();
      if (!data) throw new Error('Tu n’es plus connecté. Reconnecte-toi puis relance l’export.');
      const rows = buildRows(data);
      // Date LOCALE : `toISOString()` datait l'export de la veille dès 22 h en France.
      const dateStr = todayISO();
      if (Platform.OS === 'web') {
        await exportXlsx(rows, `mes-donnees-tresorerie-${dateStr}.xlsx`);
      } else {
        const csv = csvFrom(rows);
        const res = await Share.share({ message: '﻿' + csv, title: `mes-donnees-tresorerie-${dateStr}.csv` });
        // Partage annulé : rien n'a échoué, mais rien n'a été exporté non plus — pas de « ! ».
        if (res.action === Share.dismissedAction) { setBusy(false); return; }
      }
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      console.warn('[mes-donnees] export échoué:', e);
      setError(e instanceof Error ? e.message : "L'export n'a pas pu être généré. Vérifie ta connexion, puis réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const loading = pLoading || aLoading;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right']}>
        {/* En-tête PARTAGÉ, comme les autres pages secondaires : cette page recopiait le sien, avec
            un bouton « Retour » d'une autre taille et sans rôle d'accessibilité. */}
        <ScreenHeader title="Mes données" onBack={goBack} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.subtitle}>
            Exporte l'ensemble des données personnelles te concernant dans un fichier compatible Excel.
          </Text>

          {readOnly && (
            <View style={styles.notice}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Consultation seule : l'export produirait un fichier contenant les données de la
                personne dont tu consultes le compte. Il n'appartient qu'à elle de le demander.
              </Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contenu de l'export</Text>
            <View style={styles.bullet}>
              <Ionicons name="person-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.bulletText}>Informations de profil (nom, email, profil financier, marge de sécurité, allocations).</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="wallet-outline" size={18} color={COLORS.checking} />
              <Text style={styles.bulletText}>Tes comptes (personnels, joints & partagés : rôle, part, mode) et leurs soldes {loading ? '' : `(${accounts.length} compte${accounts.length > 1 ? 's' : ''})`}, avec les membres de tes comptes partagés.</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="list-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.bulletText}>Toutes tes transactions (avec récurrences et échéances modifiées).</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="flag-outline" size={18} color={COLORS.teal} />
              <Text style={styles.bulletText}>Projets, objectifs, crédits, clôtures mensuelles, réservations & cumuls.</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="trophy-outline" size={18} color={COLORS.orange} />
              <Text style={styles.bulletText}>Gamification (relyks, série, succès débloqués).</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="help-circle-outline" size={18} color={COLORS.violet} />
              <Text style={styles.bulletText}>Tes réponses au questionnaire, à date.</Text>
            </View>
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.exportBtn, (busy || loading || readOnly) && { opacity: 0.6 }]}
            onPress={handleExport}
            disabled={busy || loading || readOnly}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || loading || readOnly, busy }}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.onAccent} />
            ) : (
              <>
                <Ionicons name={done ? 'checkmark-circle' : 'download-outline'} size={20} color={COLORS.onAccent} />
                <Text style={styles.exportText}>{done ? 'Export généré !' : 'Exporter mes données'}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.note}>
            {Platform.OS === 'web'
              ? 'Le fichier Excel (.xlsx) est téléchargé sur ton appareil. Ouvre-le avec Excel, Numbers ou Google Sheets.'
              : 'Le fichier (.csv, compatible Excel) est partagé via le menu de partage de ton appareil.'}
            {'\n'}Conformément au RGPD, tu peux exporter tes données à tout moment.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 20, lineHeight: 20 },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 16 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: c.textSecondary },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', borderRadius: 12, padding: 12, marginBottom: 14 },
    errorText: { flex: 1, fontSize: 12.5, color: c.danger, lineHeight: 18 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 14, marginBottom: 20 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 2 },
    bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    bulletText: { flex: 1, fontSize: 14, color: c.textSecondary, lineHeight: 20 },
    exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14 },
    exportText: { fontSize: 16, fontWeight: '700', color: c.onAccent },
    note: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  });
}
