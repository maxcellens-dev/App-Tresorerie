/**
 * Calculator — calculatrice simple, flottante et déplaçable.
 * Montée une seule fois à la racine (cf. app/_layout.tsx). Visible uniquement quand
 * useCalculator().isOpen est vrai. On la déplace en glissant sa barre de titre, et on
 * la ferme via la croix. Aucun fond plein écran : le reste de l'app reste cliquable.
 */
import React, { useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder,
  useWindowDimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useCalculator } from '../contexts/CalculatorContext';

const WIDTH = 260;

type Op = '+' | '-' | '×' | '÷';

/** Applique une opération binaire en virgule flottante. */
function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
  }
}

/** Formate un nombre pour l'écran : pas de notation scientifique abusive, max 10 chiffres. */
function formatNum(n: number): string {
  if (!isFinite(n)) return 'Erreur';
  if (Number.isInteger(n)) return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  // Limite la longueur tout en gardant des décimales utiles.
  const rounded = Math.round(n * 1e8) / 1e8;
  return rounded.toLocaleString('fr-FR', { maximumFractionDigits: 8 });
}

export default function Calculator() {
  const { isOpen, close } = useCalculator();
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { width: winW, height: winH } = useWindowDimensions();

  // Position de départ : centrée horizontalement, dans le tiers supérieur.
  const startX = Math.max(8, winW / 2 - WIDTH / 2);
  const startY = Math.max(60, winH * 0.18);
  const pan = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        // @ts-ignore — accès aux valeurs courantes pour caler l'offset.
        pan.setOffset({ x: pan.x._value, y: pan.y._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => pan.flattenOffset(),
    })
  ).current;

  // ── État de la calculatrice ──
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null); // accumulateur
  const [op, setOp] = useState<Op | null>(null);
  const [overwrite, setOverwrite] = useState(true);     // le prochain chiffre remplace l'écran
  const [memo, setMemo] = useState<string>('');         // ex. « 12 + »

  const num = (s: string) => parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;

  const inputDigit = (d: string) => {
    setDisplay((cur) => {
      if (overwrite) { setOverwrite(false); return d; }
      if (cur.replace(/[^0-9]/g, '').length >= 12) return cur; // limite raisonnable
      return cur === '0' ? d : cur + d;
    });
  };

  const inputDot = () => {
    if (overwrite) { setDisplay('0,'); setOverwrite(false); return; }
    setDisplay((cur) => (cur.includes(',') ? cur : cur + ','));
  };

  const clearAll = () => {
    setDisplay('0'); setAcc(null); setOp(null); setOverwrite(true); setMemo('');
  };

  const backspace = () => {
    if (overwrite) return;
    setDisplay((cur) => {
      const next = cur.length <= 1 || (cur.length === 2 && cur.startsWith('-')) ? '0' : cur.slice(0, -1);
      return next === '' || next === '-' ? '0' : next;
    });
  };

  const toggleSign = () => setDisplay((cur) => (cur === '0' ? cur : cur.startsWith('-') ? cur.slice(1) : '-' + cur));

  const percent = () => {
    const v = num(display);
    // Avec une opération en cours (+/−), le % s'applique à l'accumulateur (ex. 200 + 10% = 220).
    // Sinon, simple division par 100.
    const result = acc != null && (op === '+' || op === '-') ? acc * (v / 100) : v / 100;
    setDisplay(formatNum(result));
    setOverwrite(true);
  };

  const chooseOp = (nextOp: Op) => {
    const current = num(display);
    if (acc != null && op && !overwrite) {
      const r = compute(acc, current, op);
      setAcc(r);
      setDisplay(formatNum(r));
      setMemo(`${formatNum(r)} ${nextOp}`);
    } else {
      setAcc(current);
      setMemo(`${formatNum(current)} ${nextOp}`);
    }
    setOp(nextOp);
    setOverwrite(true);
  };

  const equals = () => {
    if (acc == null || !op) return;
    const current = num(display);
    const r = compute(acc, current, op);
    setDisplay(formatNum(r));
    setMemo('');
    setAcc(null);
    setOp(null);
    setOverwrite(true);
  };

  if (!isOpen) return null;

  const Btn = ({ label, onPress, variant = 'num', icon, flex = 1, opValue }: {
    label?: string; onPress: () => void; variant?: 'num' | 'op' | 'fn' | 'eq'; icon?: any; flex?: number; opValue?: Op;
  }) => {
    const bg =
      variant === 'op' ? COLORS.accent + '22'
      : variant === 'eq' ? COLORS.accent
      : variant === 'fn' ? COLORS.card
      : COLORS.card;
    const color =
      variant === 'eq' ? '#fff'
      : variant === 'op' ? COLORS.accent
      : variant === 'fn' ? COLORS.textSecondary
      : COLORS.text;
    const active = variant === 'op' && overwrite && op != null && op === opValue;
    return (
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: bg, flex }, active && { backgroundColor: COLORS.accent }]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {icon
          ? <Ionicons name={icon} size={20} color={color} />
          : <Text style={[styles.btnText, { color }, active && { color: '#fff' }]}>{label}</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <Animated.View
      style={[styles.window, { transform: pan.getTranslateTransform() }]}
      {...(Platform.OS === 'web' ? { pointerEvents: 'auto' } : {})}
    >
      {/* Barre de titre = poignée de déplacement + fermeture */}
      <View style={styles.titleBar} {...panResponder.panHandlers}>
        <View style={styles.titleLeft}>
          <Ionicons name="calculator-outline" size={15} color={COLORS.textSecondary} />
          <Text style={styles.titleText}>Calculatrice</Text>
        </View>
        <TouchableOpacity onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer la calculatrice" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Écran */}
      <View style={styles.screen}>
        <Text style={styles.memo} numberOfLines={1}>{memo}</Text>
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{display}</Text>
      </View>

      {/* Pavé */}
      <View style={styles.pad}>
        <View style={styles.row}>
          <Btn label="AC" variant="fn" onPress={clearAll} />
          <Btn label="±" variant="fn" onPress={toggleSign} />
          <Btn label="%" variant="fn" onPress={percent} />
          <Btn label="÷" variant="op" opValue="÷" onPress={() => chooseOp('÷')} />
        </View>
        <View style={styles.row}>
          <Btn label="7" onPress={() => inputDigit('7')} />
          <Btn label="8" onPress={() => inputDigit('8')} />
          <Btn label="9" onPress={() => inputDigit('9')} />
          <Btn label="×" variant="op" opValue="×" onPress={() => chooseOp('×')} />
        </View>
        <View style={styles.row}>
          <Btn label="4" onPress={() => inputDigit('4')} />
          <Btn label="5" onPress={() => inputDigit('5')} />
          <Btn label="6" onPress={() => inputDigit('6')} />
          <Btn label="−" variant="op" opValue="-" onPress={() => chooseOp('-')} />
        </View>
        <View style={styles.row}>
          <Btn label="1" onPress={() => inputDigit('1')} />
          <Btn label="2" onPress={() => inputDigit('2')} />
          <Btn label="3" onPress={() => inputDigit('3')} />
          <Btn label="+" variant="op" opValue="+" onPress={() => chooseOp('+')} />
        </View>
        <View style={styles.row}>
          <Btn label="0" onPress={() => inputDigit('0')} flex={2} />
          <Btn label="," onPress={inputDot} />
          <Btn icon="backspace-outline" variant="fn" onPress={backspace} />
        </View>
        <View style={styles.row}>
          <Btn label="=" variant="eq" onPress={equals} flex={1} />
        </View>
      </View>
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    window: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: WIDTH,
      backgroundColor: c.cardSolid,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.cardBorder,
      paddingBottom: 10,
      zIndex: 9999,
      elevation: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 18,
      ...(Platform.OS === 'web' ? { cursor: 'grab' as any } : {}),
    },
    titleBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomWidth: 1,
      borderBottomColor: c.cardBorder,
    },
    titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    titleText: { color: c.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
    closeBtn: { padding: 2 },
    screen: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      minHeight: 64,
      justifyContent: 'flex-end',
    },
    memo: { color: c.textSecondary, fontSize: 13, textAlign: 'right', minHeight: 16 },
    display: { color: c.text, fontSize: 34, fontWeight: '700', textAlign: 'right', letterSpacing: -0.5 },
    pad: { paddingHorizontal: 8, gap: 7 },
    row: { flexDirection: 'row', gap: 7 },
    btn: {
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: { fontSize: 20, fontWeight: '600' },
  });
}
