import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Share, ActivityIndicator } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';
import { useNavBack } from '../../hooks/useNavBack';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/useProfile';
import { useAccounts } from '../../hooks/useAccounts';
import { useQuestionnaireAnswers } from '../../hooks/useFinancialProfile';
import { CURRENCY_SYMBOL } from '../../lib/currency';


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

export default function MesDonneesScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile, isLoading: pLoading } = useProfile(user?.id);
  const { data: accounts = [], isLoading: aLoading } = useAccounts(user?.id);
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + Number(a.balance), 0), [accounts]);

  // Construit les lignes structurées (réutilisées pour le .xlsx et le repli .csv).
  const buildRows = (): Row[] => {
    const now = new Date();
    const rows: Row[] = [];
    rows.push({ type: 'title', cells: ['Mes données Relyka'] });
    rows.push({ type: 'subtitle', cells: ['Exporté le ' + now.toLocaleString('fr-FR')] });
    rows.push({ type: 'spacer', cells: [''] });

    rows.push({ type: 'section', cells: ['PROFIL'] });
    rows.push({ type: 'colhead', cells: ['Champ', 'Valeur'] });
    rows.push({ type: 'data', cells: ['Nom', profile?.full_name ?? ''] });
    rows.push({ type: 'data', cells: ['Email', profile?.email ?? user?.email ?? ''] });
    rows.push({ type: 'data', cells: ['Profil financier', PROFILE_LABELS[(profile as any)?.financial_profile] ?? (profile as any)?.financial_profile ?? ''] });
    rows.push({ type: 'data', cells: ['Marge de sécurité (' + CURRENCY_SYMBOL + ')', { amount: Number(profile?.safety_margin_amount ?? 0) }] });
    rows.push({ type: 'data', cells: ['Devise', (profile as any)?.currency_code ?? 'EUR'] });
    rows.push({ type: 'data', cells: ['Allocation épargne (%)', { amount: Number((profile as any)?.allocation_save_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation investissement (%)', { amount: Number((profile as any)?.allocation_invest_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation plaisir (%)', { amount: Number((profile as any)?.allocation_enjoy_percent ?? 0) }] });
    rows.push({ type: 'data', cells: ['Allocation conserver (%)', { amount: Number((profile as any)?.allocation_keep_percent ?? 0) }] });
    rows.push({ type: 'spacer', cells: [''] });

    rows.push({ type: 'section', cells: ['COMPTES'] });
    rows.push({ type: 'colhead', cells: ['Nom', 'Type', 'Solde (' + CURRENCY_SYMBOL + ')'] });
    accounts.forEach((a) => {
      rows.push({ type: 'data', cells: [a.name, ACCOUNT_TYPE_LABELS[a.type] ?? a.type, { amount: Number(a.balance) }] });
    });
    rows.push({ type: 'total', cells: ['', 'TOTAL', { amount: totalBalance }] });
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

  const handleExport = async () => {
    setBusy(true); setDone(false);
    try {
      const rows = buildRows();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (Platform.OS === 'web') {
        await exportXlsx(rows, `mes-donnees-tresorerie-${dateStr}.xlsx`);
      } else {
        const csv = csvFrom(rows);
        await Share.share({ message: '﻿' + csv, title: `mes-donnees-tresorerie-${dateStr}.csv` });
      }
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      console.warn('[mes-donnees] export échoué:', e);
    } finally {
      setBusy(false);
    }
  };

  const loading = pLoading || aLoading;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Mes données</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.subtitle}>
            Exportez l'ensemble des données personnelles vous concernant dans un fichier compatible Excel.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contenu de l'export</Text>
            <View style={styles.bullet}>
              <Ionicons name="person-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.bulletText}>Informations de profil (nom, email, profil financier, marge de sécurité, allocations).</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="wallet-outline" size={18} color={COLORS.checking} />
              <Text style={styles.bulletText}>Liste de vos comptes et leurs soldes {loading ? '' : `(${accounts.length} compte${accounts.length > 1 ? 's' : ''})`}.</Text>
            </View>
            <View style={styles.bullet}>
              <Ionicons name="help-circle-outline" size={18} color={COLORS.violet} />
              <Text style={styles.bulletText}>Vos réponses au questionnaire, à date.</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.exportBtn, (busy || loading) && { opacity: 0.6 }]} onPress={handleExport} disabled={busy || loading} activeOpacity={0.85}>
            {busy ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <>
                <Ionicons name={done ? 'checkmark-circle' : 'download-outline'} size={20} color={COLORS.bg} />
                <Text style={styles.exportText}>{done ? 'Export généré !' : 'Exporter mes données'}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.note}>
            {Platform.OS === 'web'
              ? 'Le fichier Excel (.xlsx) est téléchargé sur votre appareil. Ouvrez-le avec Excel, Numbers ou Google Sheets.'
              : 'Le fichier (.csv, compatible Excel) est partagé via le menu de partage de votre appareil.'}
            {'\n'}Conformément au RGPD, vous pouvez exporter vos données à tout moment.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
    pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
    backBtn: { padding: 4, marginRight: 12 },
    title: { fontSize: 24, fontWeight: '700', color: c.text },
    subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 20, lineHeight: 20 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 14, marginBottom: 20 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 2 },
    bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    bulletText: { flex: 1, fontSize: 14, color: c.textSecondary, lineHeight: 20 },
    exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 16 },
    exportText: { fontSize: 16, fontWeight: '700', color: c.bg },
    note: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  });
}
