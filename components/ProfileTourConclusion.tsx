/**
 * CONCLUSION DU PARCOURS DE DÉMARRAGE — « voici ton profil financier ».
 *
 * S'affiche UNE SEULE FOIS, juste après la toute dernière bulle du guide (« Ton menu »), jamais
 * avant : pendant l'installation, le profil bouge à chaque saisie (comptes, puis récurrences), et
 * l'annoncer en cours de route revenait à interrompre l'utilisateur pour un chiffre pas encore
 * stabilisé. Ici, il conclut : « voilà ce que tes données disent de toi ».
 *
 * Deux cas, et AUCUNE action demandée dans les deux :
 *  • tout est renseigné → on présente le profil obtenu et sa répartition ;
 *  • il manque une donnée → on dit LAQUELLE, sans rien réclamer. Le jour où elle arrive, le
 *    comportement normal reprend : le profil se recalcule et l'utilisateur en est informé par
 *    ProfileChangeModal.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useGuide } from '../contexts/GuideContext';
import { useFinancialProfile } from '../hooks/useFinancialProfile';
import { usePilotageData } from '../hooks/usePilotageData';
import { useProfile } from '../hooks/useProfile';
import { PROFILE_INFO, PROFILE_ALLOCATIONS } from '../lib/financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel } from '../lib/securityCushion';
import type { FinancialProfileId } from '../types/database';
import { sheetWidth } from '../lib/appLayout';

export default function ProfileTourConclusion() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user, isImpersonating } = useAuth();
  const guide = useGuide();
  const { data: fp } = useFinancialProfile(user?.id);
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: userProfile } = useProfile(user?.id);

  // Le parcours est TERMINÉ (dernière bulle passée) et la conclusion n'a pas encore été montrée.
  const shouldShow = guide.tourJustFinished;
  if (isImpersonating || !shouldShow || !fp) return null;

  const profileId = (fp as any).profile_id as FinancialProfileId;
  const info = PROFILE_INFO[profileId];
  const alloc = PROFILE_ALLOCATIONS[profileId];
  if (!info || !alloc) return null;

  const income = pilotage?.avg_monthly_income ?? 0;
  const savings = pilotage?.current_savings ?? 0;
  const marginSet = (userProfile as any)?.safety_margin_amount != null;
  const variableSet = Number((userProfile as any)?.weekly_variable_budget ?? 0) > 0
    || Number(pilotage?.variable_envelope_initial ?? 0) > 0;

  /* Ce qui manque ENCORE pour que le profil soit pleinement calculé. Le revenu est la seule donnée
     bloquante (sans lui, aucun ratio n'a de sens et le profil reste au plus prudent) ; les autres
     affinent le Relyka. On les énonce, on ne les réclame pas. */
  const missing: string[] = [];
  if (income <= 0) missing.push('ta rentrée d’argent, enregistrée en récurrente');
  if (savings <= 0) missing.push('un compte d’épargne avec son solde');
  if (!variableSet) missing.push('ton estimation de dépenses variables');
  if (!marginSet) missing.push('ta marge de sécurité');

  const cushionMonths = computeSecurityCushion({
    availableSavings: savings,
    avgMonthlyIncome: income,
  }).months;

  const ALLOC_ROWS = [
    { label: 'Épargner', pct: alloc.save, color: COLORS.green ?? COLORS.emerald },
    { label: 'Investir', pct: alloc.invest, color: COLORS.violet },
    { label: 'Confort', pct: alloc.enjoy, color: COLORS.orange },
    { label: 'Conserver', pct: alloc.keep, color: COLORS.blue },
  ];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            <Text style={styles.eyebrow}>Pour finir</Text>
            <Text style={styles.emoji}>{info.emoji}</Text>
            <Text style={styles.title}>Ton profil : {info.name}</Text>
            <Text style={styles.desc}>{info.description}</Text>

            {/* Ce que le profil DÉCIDE : la répartition. C'est son unique rôle, autant le montrer. */}
            <View style={styles.allocCard}>
              <Text style={styles.allocTitle}>Comment ton Relyka sera réparti</Text>
              {ALLOC_ROWS.map((r) => (
                <View key={r.label} style={styles.allocRow}>
                  <Text style={styles.allocLabel}>{r.label}</Text>
                  <View style={styles.allocTrack}>
                    <View style={[styles.allocFill, { width: `${r.pct}%`, backgroundColor: r.color }]} />
                  </View>
                  <Text style={[styles.allocPct, { color: r.color }]}>{r.pct} %</Text>
                </View>
              ))}
            </View>

            {missing.length > 0 ? (
              /* CONSTAT, pas consigne : aucun bouton, aucune obligation. On explique simplement que
                 le profil s'affinera tout seul quand ces données arriveront. */
              <View style={styles.missingCard}>
                <View style={styles.missingHead}>
                  <Ionicons name="information-circle-outline" size={17} color={COLORS.orange} />
                  <Text style={styles.missingTitle}>Il s’affinera encore</Text>
                </View>
                <Text style={styles.missingText}>
                  Pour l’instant Relyka reste prudent : il lui manque {missing.join(', ')}.
                  {'\n'}Dès que ce sera renseigné, ton profil se met à jour tout seul — on te le dira.
                </Text>
              </View>
            ) : (
              <Text style={styles.okText}>
                Calculé sur tes vraies données{cushionMonths != null ? ` — ton épargne couvre ≈ ${securityMonthsLabel(cushionMonths)} de revenus` : ''}.
                {'\n'}Il évoluera tout seul au fil de tes mois.
              </Text>
            )}

          </ScrollView>

          <TouchableOpacity style={styles.cta} onPress={() => guide.done('g2_profile_shown')} activeOpacity={0.85}>
            <Text style={styles.ctaText}>C’est parti</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    sheet: {
      ...sheetWidth, maxHeight: '86%',
      backgroundColor: c.cardSolid, borderRadius: 26,
      borderWidth: 1, borderColor: c.emerald + '44',
      paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16, gap: 12,
    },
    content: { alignItems: 'center', gap: 8 },
    eyebrow: { fontSize: 11.5, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 1 },
    emoji: { fontSize: 40, marginTop: 2 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.4 },
    desc: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },

    allocCard: {
      width: '100%', marginTop: 10, gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14,
    },
    allocTitle: { fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 2 },
    allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    allocLabel: { width: 74, fontSize: 12.5, color: c.text },
    allocTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden' },
    allocFill: { height: 6, borderRadius: 3 },
    allocPct: { width: 40, fontSize: 12.5, fontWeight: '800', textAlign: 'right' },

    missingCard: {
      width: '100%', marginTop: 4, gap: 6,
      borderWidth: 1, borderColor: c.orange + '44', backgroundColor: c.orange + '12',
      borderRadius: 16, padding: 13,
    },
    missingHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    missingTitle: { fontSize: 13.5, fontWeight: '800', color: c.orange },
    missingText: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18.5 },

    okText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18.5, marginTop: 4 },

    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 15,
    },
    ctaText: { fontSize: 15.5, fontWeight: '800', color: c.bg },
  });
}
