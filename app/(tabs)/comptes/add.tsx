import { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAddAccount } from '../../../hooks/useAccounts';
import { useAppColors } from '../../../hooks/useAppColors';
import { useFiscalEnvelopeRates } from '../../../hooks/useFiscalEnvelopes';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../../lib/dateUtils';


const TYPES = [
  { value: 'checking', label: 'Courant' },
  { value: 'savings', label: 'Épargne' },
  { value: 'investment', label: 'Investissement' },
  { value: 'other', label: 'Autre' },
];

export default function AddAccountScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { user } = useAuth();
  const addAccount = useAddAccount(user?.id);
  const scrollRef = useRef<ScrollView>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('EUR');
  const [balance, setBalance] = useState('0');
  const [initDate, setInitDate] = useState(todayISO());
  const [initDateDisplay, setInitDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showCalendar, setShowCalendar] = useState(false);
  const [fiscalEnvelope, setFiscalEnvelope] = useState<string>('pea');
  const [initialContributed, setInitialContributed] = useState('');
  const { data: fiscalRates = [] } = useFiscalEnvelopeRates();

  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);

  function showError(msg: string, fields: string[]) {
    setFormError(msg);
    setErrorFields(fields);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function clearFieldError(field: string) {
    setErrorFields((prev) => prev.filter((f) => f !== field));
    setFormError(null);
  }

  async function handleSubmit() {
    setFormError(null);
    setErrorFields([]);

    const trimmed = name.trim();
    if (!trimmed) {
      showError('Le nom du compte est obligatoire.', ['name']);
      return;
    }
    const num = parseFloat(balance.replace(',', '.'));
    if (Number.isNaN(num)) {
      showError('Le solde initial doit être un nombre valide.', ['balance']);
      return;
    }
    if (!initDate) {
      showError('La date du solde est obligatoire.', ['initDate']);
      return;
    }

    try {
      await addAccount.mutateAsync({
        name: trimmed,
        type,
        currency: currency || 'EUR',
        balance: num,
        fiscal_envelope: type === 'investment' ? fiscalEnvelope : null,
        initial_contributed: type === 'investment' && initialContributed.trim() ? parseFloat(initialContributed.replace(',', '.')) : null,
        init_date: initDate,
      });

      router.back();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Impossible d'enregistrer.", []);
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <Text style={styles.text}>Connectez-vous pour ajouter un compte.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Nouveau compte</Text>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          {/* Bandeau d'erreur global */}
          {formError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorBannerText}>{formError}</Text>
            </View>
          )}

          <Text style={styles.label}>Nom du compte *</Text>
          <TextInput
            style={[styles.input, errorFields.includes('name') && styles.inputError]}
            value={name}
            onChangeText={(v) => { setName(v); clearFieldError('name'); }}
            placeholder="Ex. Compte courant"
            placeholderTextColor={COLORS.textSecondary}
          />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[styles.chip, type === t.value && styles.chipActive]}
                onPress={() => setType(t.value)}
              >
                <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {type === 'investment' && (
            <>
              <Text style={styles.label}>Enveloppe fiscale</Text>
              <View style={styles.chipRow}>
                {fiscalRates.map((r) => (
                  <TouchableOpacity
                    key={r.envelope}
                    style={[styles.chip, fiscalEnvelope === r.envelope && styles.chipActive]}
                    onPress={() => setFiscalEnvelope(r.envelope)}
                  >
                    <Text style={[styles.chipText, fiscalEnvelope === r.envelope && styles.chipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Apport (Montant total des apports à date)</Text>
              <TextInput
                style={styles.input}
                value={initialContributed}
                onChangeText={(v) => setInitialContributed(v.replace(/[^0-9.,]/g, ''))}
                placeholder="Ex. 5000"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="decimal-pad"
              />
              <Text style={styles.hintSmall}>
                Montant total que vous avez versé sur ce compte à ce jour (hors plus-values). Sert de base à l'« Apport » dans la page Projection.
              </Text>
            </>
          )}

          {/* Solde initial + date */}
          <Text style={styles.label}>Solde initial *</Text>
          <TextInput
            style={[styles.input, errorFields.includes('balance') && styles.inputError]}
            value={balance}
            onChangeText={(v) => { setBalance(v); clearFieldError('balance'); }}
            placeholder="0"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />

          <Text style={styles.label}>Date du solde *</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }, errorFields.includes('initDate') && styles.inputError]}
              value={initDateDisplay}
              onChangeText={(text) => {
                setInitDateDisplay(text);
                const parsed = parseDateFromFrench(text);
                if (parsed) { setInitDate(parsed); clearFieldError('initDate'); }
              }}
              onBlur={() => { if (initDate) setInitDateDisplay(formatDateFrench(initDate)); }}
              placeholder="jj-mm-aaaa"
              placeholderTextColor={COLORS.textSecondary}
            />
            <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowCalendar(true)}>
              <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {/* Note explicative */}
          <View style={styles.initDateNote}>
            <Ionicons name="information-circle-outline" size={15} color={COLORS.textSecondary} style={{ marginTop: 1 }} />
            <Text style={styles.initDateNoteText}>
              Indiquez la date exacte à laquelle ce solde a été constaté (ex. relevé bancaire du 12 mai → saisissez le 12 mai).
              Les transactions que vous saisirez à une date antérieure mais dans ce même mois seront considérées comme déjà incluses dans ce solde — elles n'auront aucun impact sur celui-ci.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, addAccount.isPending && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={addAccount.isPending}
            accessibilityRole="button"
          >
            {addAccount.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.submitLabel}>Créer le compte</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Calendar Modal */}
      <Modal visible={showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
        <Pressable style={styles.calendarOverlay} onPress={() => setShowCalendar(false)}>
          <Pressable style={styles.calendarContainer} onPress={() => {}}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setShowCalendar(false)}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text }}>Date du solde</Text>
              <View style={{ width: 50 }} />
            </View>
            <CalendarWithPicker
              current={initDate}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setInitDate(day.dateString);
                setInitDateDisplay(formatDateFrench(day.dateString));
                clearFieldError('initDate');
                setShowCalendar(false);
              }}
              markedDates={initDate ? { [initDate]: { selected: true, selectedColor: COLORS.emerald, selectedTextColor: '#000' } } : {}}
              accentColor={COLORS.emerald}
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor="#334155"
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.danger + '1F',
    borderWidth: 1,
    borderColor: c.danger + '66',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: c.danger, lineHeight: 18 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
    marginBottom: 20,
  },
  inputError: { borderColor: c.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  hintSmall: { fontSize: 11, color: c.textSecondary, marginTop: -12, marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  initDateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 24,
  },
  initDateNoteText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  text: { color: c.text, marginBottom: 16 },
  btn: { backgroundColor: c.card, padding: 14, borderRadius: 12, alignSelf: 'flex-start' },
  btnLabel: { color: c.text, fontWeight: '600' },
  submitBtn: { backgroundColor: c.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  calendarBtn: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarContainer: {
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    width: '90%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
});
}
