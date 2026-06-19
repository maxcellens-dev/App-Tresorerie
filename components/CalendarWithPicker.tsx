import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// Calendriers en français (jours/mois) — appliqué globalement à tous les calendriers de l'app.
LocaleConfig.locales.fr = {
  monthNames: MONTH_NAMES,
  monthNamesShort: ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'],
  dayNames: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  dayNamesShort: ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'],
  today: "Aujourd'hui",
};
LocaleConfig.defaultLocale = 'fr';

function toDateString(year: number, month: number, day = 1): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface Props {
  current?: string;
  minDate?: string;
  maxDate?: string;
  onDayPress?: (day: { dateString: string }) => void;
  markedDates?: Record<string, any>;
  theme?: Record<string, any>;
  style?: any;
  accentColor?: string;
  bgColor?: string;
  textColor?: string;
  textSecondaryColor?: string;
}

export default function CalendarWithPicker({
  current,
  minDate,
  maxDate,
  onDayPress,
  markedDates,
  theme,
  style,
  accentColor = '#00B67A',
  bgColor = '#0f172a',
  textColor = '#ffffff',
  textSecondaryColor = '#94a3b8',
}: Props) {
  const nowYear = new Date().getFullYear();
  const initialDate = current ? new Date(current + 'T00:00:00') : new Date();
  const [displayedMonth, setDisplayedMonth] = useState(toDateString(initialDate.getFullYear(), initialDate.getMonth() + 1));
  const [calKey, setCalKey] = useState(0);
  const [picker, setPicker] = useState<'none' | 'year' | 'month'>('none');
  const [pickerYear, setPickerYear] = useState(initialDate.getFullYear());
  const [yearRangeStart, setYearRangeStart] = useState(Math.floor(initialDate.getFullYear() / 10) * 10);

  function navigateTo(year: number, month: number) {
    const d = toDateString(year, month);
    setDisplayedMonth(d);
    setCalKey((k) => k + 1);
    setPicker('none');
  }

  function headerLabel(yyyyMM: string) {
    const [year, month] = yyyyMM.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  if (picker === 'year') {
    const years = Array.from({ length: 12 }, (_, i) => yearRangeStart + i);
    return (
      <View style={[pickerStyles.container, { backgroundColor: bgColor }]}>
        <View style={pickerStyles.nav}>
          <TouchableOpacity onPress={() => setYearRangeStart((y) => y - 12)} style={pickerStyles.navBtn}>
            <Text style={[pickerStyles.navArrow, { color: accentColor }]}>‹</Text>
          </TouchableOpacity>
          <Text style={[pickerStyles.navTitle, { color: textColor }]}>
            {yearRangeStart} – {yearRangeStart + 11}
          </Text>
          <TouchableOpacity onPress={() => setYearRangeStart((y) => y + 12)} style={pickerStyles.navBtn}>
            <Text style={[pickerStyles.navArrow, { color: accentColor }]}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={pickerStyles.grid}>
          {years.map((y) => {
            const isSelected = y === pickerYear;
            const isCurrent = y === nowYear;
            return (
              <TouchableOpacity
                key={y}
                style={[
                  pickerStyles.cell,
                  isSelected && { backgroundColor: accentColor },
                  isCurrent && !isSelected && [pickerStyles.cellToday, { borderColor: accentColor }],
                ]}
                onPress={() => {
                  setPickerYear(y);
                  setPicker('month');
                }}
              >
                <Text style={[pickerStyles.cellText, { color: isSelected ? '#000' : textColor }]}>{y}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity onPress={() => setPicker('none')} style={pickerStyles.cancel}>
          <Text style={[pickerStyles.cancelText, { color: textSecondaryColor }]}>Annuler</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (picker === 'month') {
    const displayedYear = new Date(displayedMonth + '-01T00:00:00').getFullYear();
    return (
      <View style={[pickerStyles.container, { backgroundColor: bgColor }]}>
        <View style={pickerStyles.nav}>
          <TouchableOpacity onPress={() => { setPickerYear((y) => y - 1); }} style={pickerStyles.navBtn}>
            <Text style={[pickerStyles.navArrow, { color: accentColor }]}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPicker('year')} style={pickerStyles.navTitleBtn}>
            <Text style={[pickerStyles.navTitle, { color: accentColor }]}>{pickerYear}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setPickerYear((y) => y + 1); }} style={pickerStyles.navBtn}>
            <Text style={[pickerStyles.navArrow, { color: accentColor }]}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={pickerStyles.grid}>
          {MONTH_NAMES.map((name, idx) => {
            const month = idx + 1;
            const isSelected = pickerYear === displayedYear && month === new Date(displayedMonth + '-01T00:00:00').getMonth() + 1;
            const isCurrentMonth = pickerYear === nowYear && month === new Date().getMonth() + 1;
            return (
              <TouchableOpacity
                key={month}
                style={[
                  pickerStyles.cell,
                  isSelected && { backgroundColor: accentColor },
                  isCurrentMonth && !isSelected && [pickerStyles.cellToday, { borderColor: accentColor }],
                ]}
                onPress={() => navigateTo(pickerYear, month)}
              >
                <Text style={[pickerStyles.cellText, { color: isSelected ? '#000' : textColor }]}>
                  {name.slice(0, 3)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity onPress={() => setPicker('none')} style={pickerStyles.cancel}>
          <Text style={[pickerStyles.cancelText, { color: textSecondaryColor }]}>Annuler</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Calendar
      key={calKey}
      firstDay={1}
      current={displayedMonth}
      minDate={minDate}
      maxDate={maxDate}
      onDayPress={onDayPress}
      markedDates={markedDates}
      style={style}
      renderHeader={(_date: any) => {
        const label = headerLabel(displayedMonth);
        return (
          <TouchableOpacity
            onPress={() => {
              const y = new Date(displayedMonth + '-01T00:00:00').getFullYear();
              setPickerYear(y);
              setYearRangeStart(Math.floor(y / 12) * 12);
              setPicker('year');
            }}
            style={pickerStyles.headerBtn}
          >
            <Text style={[pickerStyles.headerText, { color: accentColor }]}>{label}</Text>
            <Text style={[pickerStyles.headerHint, { color: textSecondaryColor }]}>Appuyer pour naviguer</Text>
          </TouchableOpacity>
        );
      }}
      onMonthChange={(month: any) => {
        if (month?.dateString) setDisplayedMonth(month.dateString.slice(0, 7));
      }}
      theme={{
        backgroundColor: bgColor,
        calendarBackground: bgColor,
        textSectionTitleColor: textColor,
        selectedDayBackgroundColor: accentColor,
        selectedDayTextColor: '#000',
        todayTextColor: accentColor,
        dayTextColor: textColor,
        textDisabledColor: textSecondaryColor,
        monthTextColor: textColor,
        arrowColor: accentColor,
        ...theme,
      }}
    />
  );
}

const pickerStyles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  navBtn: { padding: 8 },
  navTitleBtn: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 18, fontWeight: '700' },
  navArrow: { fontSize: 28, fontWeight: '300', lineHeight: 30 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 4,
  },
  cell: {
    width: '22%',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cellToday: {
    borderWidth: 1,
  },
  cellText: { fontSize: 14, fontWeight: '500' },
  cancel: { alignItems: 'center', marginTop: 16, padding: 8 },
  cancelText: { fontSize: 14 },
  headerBtn: { alignItems: 'center', paddingVertical: 4 },
  headerText: { fontSize: 16, fontWeight: '700' },
  headerHint: { fontSize: 10, marginTop: 2 },
});
