/**
 * PasswordInput — champ de mot de passe avec ŒIL « afficher / masquer », commun à tous les écrans
 * qui en saisissent un (connexion, inscription, réinitialisation, changement dans les Paramètres).
 *
 * POURQUOI CE COMPOSANT EXISTE
 *  1. La politique impose 12 caractères avec majuscule, minuscule, chiffre ET caractère spécial
 *     (lib/auth/passwordPolicy). Saisir ça À L'AVEUGLE, au doigt, sur un clavier mobile qui bascule
 *     trois fois de page, c'est la première cause d'échec de l'inscription — et la jauge de
 *     robustesse ne sert à rien si l'on ne peut pas relire ce qu'on a tapé.
 *  2. `autoComplete` / `textContentType` : sans eux, les gestionnaires de mots de passe (trousseau
 *     iOS, Google, 1Password, navigateur) ne proposent NI le remplissage NI l'enregistrement. Sur
 *     web c'est l'attribut HTML `autocomplete` qui décide, et il était absent partout.
 *
 * `variant` décrit le RÔLE du champ, pas son apparence : c'est lui qui choisit les bons indices
 * d'autoremplissage (`current-password` pour se connecter, `new-password` pour en définir un neuf —
 * ce dernier empêche aussi le navigateur de proposer l'ancien mot de passe dans le champ « nouveau »).
 */
import { forwardRef, useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform, type TextInputProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props extends Omit<TextInputProps, 'secureTextEntry' | 'style'> {
  /** Style du champ lui-même (celui des autres `input` de l'écran). */
  style?: StyleProp<TextStyle>;
  /** Palette de l'écran hôte (useBrandColors sur l'auth, useAppColors dans l'app). */
  colors: { text: string; textSecondary: string };
  /** Rôle du champ → indices d'autoremplissage. */
  variant: 'current' | 'new';
}

const PasswordInput = forwardRef<TextInput, Props>(({ style, colors, variant, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  const isNew = variant === 'new';

  /* Les `styles.input` des écrans portent une MARGE BASSE (l'espacement entre deux champs). Laissée
     sur le champ, elle entrerait dans la hauteur de la boîte et l'œil — centré verticalement — se
     retrouverait sous la bordure inférieure. On la déplace donc sur l'enveloppe : le champ garde
     exactement son apparence, l'espacement entre champs est identique, et l'œil se centre sur la
     seule hauteur du champ. Le composant reste ainsi un remplacement direct de <TextInput>. */
  const { fieldStyle, wrapStyle } = useMemo(() => {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle & Record<string, unknown>;
    const { marginBottom, marginTop, marginVertical, margin, ...rest } = flat;
    return {
      fieldStyle: rest as TextStyle,
      wrapStyle: { marginBottom, marginTop, marginVertical, margin } as ViewStyle,
    };
  }, [style]);

  return (
    <View style={[styles.wrap, wrapStyle]}>
      <TextInput
        ref={ref}
        {...props}
        // Le style de l'écran garde la main ; on réserve juste la place de l'œil à droite.
        style={[fieldStyle, styles.input]}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        // `off` quand le champ est visible : certains navigateurs re-masquent la valeur d'un champ
        // marqué « password » dès qu'il reprend le focus, ce qui annulerait l'appui sur l'œil.
        autoComplete={visible ? 'off' : isNew ? 'new-password' : 'current-password'}
        textContentType={isNew ? 'newPassword' : 'password'}
        importantForAutofill="yes"
      />
      <TouchableOpacity
        style={styles.eye}
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        // Zone tactile élargie : l'icône seule (20 dp) est sous le minimum confortable au pouce.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        activeOpacity={0.7}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
});

PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;

const styles = StyleSheet.create({
  // `position: relative` implicite en RN : l'œil se place en absolu par rapport à cette boîte.
  wrap: { position: 'relative', justifyContent: 'center' },
  input: { paddingRight: 48 },
  eye: {
    position: 'absolute',
    right: 0,
    // Les marges du champ vivent sur l'enveloppe (cf. `fieldStyle`/`wrapStyle`) : ce `top/bottom: 0`
    // se cale donc bien sur la hauteur du champ seul.
    top: 0,
    bottom: 0,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
});
