/**
 * PLANTE TON ARBRE — l'installation d'un compte neuf, en cinq étapes réelles.
 *
 * Pas de questionnaire : on installe de VRAIES données, et l'arbre se dessine à partir d'elles.
 *   1. le compte courant (l'arrosoir), avec le solde du jour ;
 *   2. l'épargne (les racines) — facultative : « Je n'en ai pas » la passe ;
 *   3. ce qui revient chaque mois (salaire, loyer, abonnements) ;
 *   4. les dépenses du quotidien (une estimation par semaine) ;
 *   5. la réserve minimum.
 * Chaque étape ouvre l'écran (ou la feuille) qui sert déjà à la faire, et son état vient des
 * données ou des drapeaux du guide (lib/engagement/guideStages) : elle se coche toute seule.
 * Les étapes 4 et 5 posent `g2_variable` / `g2_margin` ; la dernière termine le guide, et la
 * conclusion (ton profil financier) s'affiche alors d'elle-même.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage, { GardenColumns } from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenCard from '../../../components/garden/GardenCard';
import GardenScene from '../../../components/garden/GardenScene';
import GardenButton from '../../../components/garden/GardenButton';
import GardenBar from '../../../components/garden/GardenBar';
import GardenIcon from '../../../components/garden/GardenIcon';
import PicoBubble from '../../../components/garden/PicoBubble';
import { EstimateSheet, MarginSheet } from '../../../components/garden/MonthSettingsSheets';
import { PLANTING_STEPS } from '../../../components/onboarding/GardenWelcomeTour';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useGardenModel } from '../../../hooks/garden/useGardenModel';
import { useGuide } from '../../../contexts/GuideContext';
import { GARDEN_COLORS as G, GARDEN_SPACE } from '../../../lib/garden/theme';

/** Pourquoi chaque étape compte, dit par Pépin (une phrase). */
const WHY = [
  "Ton compte courant, c'est ton arrosoir : c'est de là que part tout le calcul. Mets le solde que ta banque affiche aujourd'hui.",
  "Tes livrets et tes placements font tes racines et tes fruits. Même un petit montant compte. Pas d'épargne pour l'instant ? Aucun souci, passe.",
  "Ton salaire, ton loyer, tes abonnements : ce qui revient chaque mois. Coche « récurrente » en l'enregistrant, et je le prévois pour toi tous les mois.",
  "Courses, sorties, petites dépenses : donne-moi une estimation par semaine. Je l'ajuste à ton vrai rythme au fil des mois.",
  "Le minimum que tu veux toujours garder sur ton compte. Je ne le compte jamais dans ton Relyka. Zéro, c'est possible aussi.",
];

export default function DemarrerScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const guide = useGuide();
  const { core, tree } = useGardenModel();
  const { vm, profile } = core;
  const accounts = core.accountsPerso as any[];
  const [sheet, setSheet] = useState<'estimate' | 'margin' | null>(null);

  const p = profile as any;
  /* Un compte déjà installé (hors guide) n'a jamais posé les drapeaux : ses réglages existants
     suffisent alors à cocher l'épargne (facultative) et la réserve. */
  const settled = !guide.active;
  const done = [
    accounts.some((a) => a.type === 'checking'),
    accounts.some((a) => a.type === 'savings' || a.type === 'investment') || guide.flagged('g2_nudge_savings') || settled,
    !!vm.hasRecurringTx,
    guide.flagged('g2_variable') || Number(p?.weekly_variable_budget) > 0,
    guide.flagged('g2_margin') || (settled && p?.safety_margin_amount != null),
  ];
  const doneCount = done.filter(Boolean).length;
  const current = done.findIndex((d) => !d);
  const finished = current === -1;

  const open = (i: number) => {
    if (i === 0 || i === 1) router.push('/(tabs)/comptes/add' as any);
    else if (i === 2) router.push('/(tabs)/transactions/add?type=expense&recurring=1' as any);
    else setSheet(i === 3 ? 'estimate' : 'margin');
  };

  return (
    <GardenPage secondary header={<ScreenHeader title="Plante ton arbre" onBack={goBack} />}
      footer={finished
        ? <GardenButton label="Voir mon jardin" onPress={() => router.navigate('/(tabs)/jardin' as any)} />
        : <GardenButton label={current === 1 ? 'Ajouter mon épargne' : `Étape ${current + 1} : ${PLANTING_STEPS[current].title.toLowerCase()}`} onPress={() => open(current)} />}>
      <GardenColumns left={<GardenScene state={tree} options={{ id: 'start', marks: false, mood: finished ? 'joy' : 'happy' }} />} right={<>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <GardenText variant="label" color={G.branchesText}>{finished ? 'Ton arbre est planté' : 'Ton arbre se plante'}</GardenText>
            <GardenText variant="smallStrong" tabular>{doneCount} / {PLANTING_STEPS.length}</GardenText>
          </View>
          <GardenBar value={doneCount / PLANTING_STEPS.length} fill={G.primary} track={G.track} accessibilityLabel={`${doneCount} étapes sur ${PLANTING_STEPS.length}`} />
        </View>

        <PicoBubble mood={finished ? 'joy' : 'happy'}>
          {finished ? "Bravo, ton jardin est planté ! Ton Relyka et ton arbre se mettent à jour tout seuls à chaque opération. Reviens quand tu veux faire le tour de ton jardin." : WHY[current]}
        </PicoBubble>

        {PLANTING_STEPS.map((s, i) => {
          const isDone = done[i];
          const isCurrent = i === current;
          return (
            <GardenCard key={s.title} onPress={isDone && i !== 3 && i !== 4 ? undefined : () => open(i)} tint={isDone ? G.branchesBg : undefined}
              accessibilityLabel={`Étape ${i + 1}, ${s.title} : ${isDone ? 'fait' : 'à faire'}`}
              style={[{ flexDirection: 'row', gap: GARDEN_SPACE.md, alignItems: 'center' }, isCurrent ? { borderColor: G.primary, borderWidth: 2 } : null]}>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? G.primary : isCurrent ? G.branchesBg : G.track }}>
                <GardenText variant="smallStrong" color={isDone ? G.onPrimary : G.inkSoft}>{isDone ? '✓' : String(i + 1)}</GardenText>
              </View>
              <GardenIcon kind={s.kind} />
              <View style={{ flex: 1, gap: 2 }}>
                <GardenText variant="bodyStrong">{s.title}</GardenText>
                <GardenText variant="small" color={G.inkSoft}>{s.text}</GardenText>
              </View>
            </GardenCard>
          );
        })}

        {/* L'épargne est facultative : on peut la passer d'un geste, sans créer de compte vide. */}
        {current === 1 ? <GardenButton label="Je n'ai pas d'épargne pour l'instant" variant="secondary" onPress={() => guide.done('g2_nudge_savings')} /> : null}
      </>} />

      <EstimateSheet visible={sheet === 'estimate'} onClose={() => setSheet(null)} userId={core.userId} onSaved={() => guide.done('g2_variable')} />
      <MarginSheet visible={sheet === 'margin'} onClose={() => setSheet(null)} userId={core.userId} onSaved={() => guide.done('g2_margin')} />
    </GardenPage>
  );
}
