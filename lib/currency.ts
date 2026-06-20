/**
 * Gestion de la devise d'affichage.
 * Change uniquement le SYMBOLE des montants partout dans l'app (pas de conversion).
 * `CURRENCY_SYMBOL` est une variable globale lue par les fonctions de formatage ;
 * `setCurrencySymbol` est appelée au chargement du profil et au changement manuel.
 */

export interface CurrencyDef {
  code: string;   // ISO 4217
  name: string;
  symbol: string;
}

/** Liste des devises (ISO 4217 — large couverture mondiale). */
export const CURRENCIES: CurrencyDef[] = [
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'USD', name: 'Dollar américain', symbol: '$' },
  { code: 'GBP', name: 'Livre sterling', symbol: '£' },
  { code: 'CHF', name: 'Franc suisse', symbol: 'CHF' },
  { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  { code: 'CNY', name: 'Yuan chinois', symbol: '¥' },
  { code: 'CAD', name: 'Dollar canadien', symbol: 'CA$' },
  { code: 'AUD', name: 'Dollar australien', symbol: 'A$' },
  { code: 'NZD', name: 'Dollar néo-zélandais', symbol: 'NZ$' },
  { code: 'SEK', name: 'Couronne suédoise', symbol: 'kr' },
  { code: 'NOK', name: 'Couronne norvégienne', symbol: 'kr' },
  { code: 'DKK', name: 'Couronne danoise', symbol: 'kr' },
  { code: 'PLN', name: 'Zloty polonais', symbol: 'zł' },
  { code: 'CZK', name: 'Couronne tchèque', symbol: 'Kč' },
  { code: 'HUF', name: 'Forint hongrois', symbol: 'Ft' },
  { code: 'RON', name: 'Leu roumain', symbol: 'lei' },
  { code: 'BGN', name: 'Lev bulgare', symbol: 'лв' },
  { code: 'RUB', name: 'Rouble russe', symbol: '₽' },
  { code: 'UAH', name: 'Hryvnia ukrainienne', symbol: '₴' },
  { code: 'TRY', name: 'Livre turque', symbol: '₺' },
  { code: 'INR', name: 'Roupie indienne', symbol: '₹' },
  { code: 'IDR', name: 'Roupie indonésienne', symbol: 'Rp' },
  { code: 'KRW', name: 'Won sud-coréen', symbol: '₩' },
  { code: 'SGD', name: 'Dollar de Singapour', symbol: 'S$' },
  { code: 'HKD', name: 'Dollar de Hong Kong', symbol: 'HK$' },
  { code: 'TWD', name: 'Dollar taïwanais', symbol: 'NT$' },
  { code: 'THB', name: 'Baht thaïlandais', symbol: '฿' },
  { code: 'MYR', name: 'Ringgit malaisien', symbol: 'RM' },
  { code: 'PHP', name: 'Peso philippin', symbol: '₱' },
  { code: 'VND', name: 'Dong vietnamien', symbol: '₫' },
  { code: 'BRL', name: 'Real brésilien', symbol: 'R$' },
  { code: 'MXN', name: 'Peso mexicain', symbol: 'MX$' },
  { code: 'ARS', name: 'Peso argentin', symbol: 'AR$' },
  { code: 'CLP', name: 'Peso chilien', symbol: 'CLP$' },
  { code: 'COP', name: 'Peso colombien', symbol: 'COL$' },
  { code: 'PEN', name: 'Sol péruvien', symbol: 'S/' },
  { code: 'UYU', name: 'Peso uruguayen', symbol: '$U' },
  { code: 'ZAR', name: 'Rand sud-africain', symbol: 'R' },
  { code: 'NGN', name: 'Naira nigérian', symbol: '₦' },
  { code: 'EGP', name: 'Livre égyptienne', symbol: 'E£' },
  { code: 'MAD', name: 'Dirham marocain', symbol: 'DH' },
  { code: 'DZD', name: 'Dinar algérien', symbol: 'DA' },
  { code: 'TND', name: 'Dinar tunisien', symbol: 'DT' },
  { code: 'XOF', name: 'Franc CFA (Ouest)', symbol: 'CFA' },
  { code: 'XAF', name: 'Franc CFA (Centre)', symbol: 'FCFA' },
  { code: 'KES', name: 'Shilling kényan', symbol: 'KSh' },
  { code: 'GHS', name: 'Cedi ghanéen', symbol: '₵' },
  { code: 'AED', name: 'Dirham des Émirats', symbol: 'AED' },
  { code: 'SAR', name: 'Riyal saoudien', symbol: 'SAR' },
  { code: 'QAR', name: 'Riyal qatari', symbol: 'QAR' },
  { code: 'KWD', name: 'Dinar koweïtien', symbol: 'KD' },
  { code: 'BHD', name: 'Dinar bahreïni', symbol: 'BD' },
  { code: 'OMR', name: 'Rial omanais', symbol: 'OMR' },
  { code: 'JOD', name: 'Dinar jordanien', symbol: 'JD' },
  { code: 'LBP', name: 'Livre libanaise', symbol: 'L£' },
  { code: 'ILS', name: 'Shekel israélien', symbol: '₪' },
  { code: 'PKR', name: 'Roupie pakistanaise', symbol: '₨' },
  { code: 'BDT', name: 'Taka bangladais', symbol: '৳' },
  { code: 'LKR', name: 'Roupie srilankaise', symbol: 'Rs' },
  { code: 'NPR', name: 'Roupie népalaise', symbol: 'Rs' },
  { code: 'ISK', name: 'Couronne islandaise', symbol: 'kr' },
  { code: 'HRK', name: 'Kuna croate', symbol: 'kn' },
  { code: 'RSD', name: 'Dinar serbe', symbol: 'дин' },
  { code: 'BAM', name: 'Mark convertible', symbol: 'KM' },
  { code: 'MKD', name: 'Denar macédonien', symbol: 'ден' },
  { code: 'ALL', name: 'Lek albanais', symbol: 'L' },
  { code: 'GEL', name: 'Lari géorgien', symbol: '₾' },
  { code: 'AZN', name: 'Manat azerbaïdjanais', symbol: '₼' },
  { code: 'KZT', name: 'Tenge kazakh', symbol: '₸' },
  { code: 'UZS', name: 'Sum ouzbek', symbol: "so'm" },
  { code: 'BYN', name: 'Rouble biélorusse', symbol: 'Br' },
  { code: 'MNT', name: 'Tugrik mongol', symbol: '₮' },
  { code: 'IRR', name: 'Rial iranien', symbol: '﷼' },
  { code: 'IQD', name: 'Dinar irakien', symbol: 'IQD' },
  { code: 'AFN', name: 'Afghani', symbol: '؋' },
  { code: 'MMK', name: 'Kyat birman', symbol: 'K' },
  { code: 'KHR', name: 'Riel cambodgien', symbol: '៛' },
  { code: 'LAK', name: 'Kip laotien', symbol: '₭' },
  { code: 'MOP', name: 'Pataca de Macao', symbol: 'MOP$' },
  { code: 'BND', name: 'Dollar de Brunei', symbol: 'B$' },
  { code: 'FJD', name: 'Dollar fidjien', symbol: 'FJ$' },
  { code: 'PGK', name: 'Kina', symbol: 'K' },
  { code: 'XPF', name: 'Franc Pacifique', symbol: '₣' },
  { code: 'BOB', name: 'Boliviano', symbol: 'Bs' },
  { code: 'PYG', name: 'Guarani paraguayen', symbol: '₲' },
  { code: 'VES', name: 'Bolívar vénézuélien', symbol: 'Bs' },
  { code: 'CRC', name: 'Colón costaricien', symbol: '₡' },
  { code: 'GTQ', name: 'Quetzal guatémaltèque', symbol: 'Q' },
  { code: 'HNL', name: 'Lempira hondurien', symbol: 'L' },
  { code: 'NIO', name: 'Córdoba nicaraguayen', symbol: 'C$' },
  { code: 'DOP', name: 'Peso dominicain', symbol: 'RD$' },
  { code: 'JMD', name: 'Dollar jamaïcain', symbol: 'J$' },
  { code: 'TTD', name: 'Dollar de Trinité', symbol: 'TT$' },
  { code: 'BBD', name: 'Dollar barbadien', symbol: 'Bds$' },
  { code: 'BSD', name: 'Dollar bahaméen', symbol: 'B$' },
  { code: 'XCD', name: 'Dollar des Caraïbes', symbol: 'EC$' },
  { code: 'ETB', name: 'Birr éthiopien', symbol: 'Br' },
  { code: 'UGX', name: 'Shilling ougandais', symbol: 'USh' },
  { code: 'TZS', name: 'Shilling tanzanien', symbol: 'TSh' },
  { code: 'ZMW', name: 'Kwacha zambien', symbol: 'ZK' },
  { code: 'AOA', name: 'Kwanza angolais', symbol: 'Kz' },
  { code: 'MZN', name: 'Metical mozambicain', symbol: 'MT' },
  { code: 'BWP', name: 'Pula botswanais', symbol: 'P' },
  { code: 'MUR', name: 'Roupie mauricienne', symbol: '₨' },
  { code: 'MGA', name: 'Ariary malgache', symbol: 'Ar' },
];

const SYMBOL_BY_CODE: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.symbol]),
);

/** Symbole d'affichage courant (modifiable globalement). */
export let CURRENCY_SYMBOL = '€';

export function currencySymbolFor(code?: string | null): string {
  return (code && SYMBOL_BY_CODE[code]) || '€';
}

export function setCurrencySymbol(code?: string | null): void {
  CURRENCY_SYMBOL = currencySymbolFor(code);
}

export const DEFAULT_CURRENCY = 'EUR';

/**
 * Arrondi « proposition » à la dizaine INFÉRIEURE — utilisé pour « Ton Relyka » et les
 * montants de recommandations (épargner, investir, plaisir, conserver) afin d'afficher des
 * montants génériques et non au centime/à l'euro près (864 € ou 869 € → 860 €).
 * NB : ne pas utiliser dans le détail « Ton Relyka » qui montre le vrai calcul.
 */
export function floorToTen(n: number): number {
  return Math.floor(n / 10) * 10;
}
