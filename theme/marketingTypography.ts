import type { TextStyle } from 'react-native';

/** Shared type scale for the web landing and installed-app welcome.
 * Font families remain owned by the central font configuration. */
export const marketingTypography = {
  eyebrow: { fontSize: 11, lineHeight: 17, fontWeight: '700', letterSpacing: 1.5 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.7 },
  featureTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 27 },
  smallBody: { fontSize: 14, lineHeight: 23 },
  primaryLabel: { fontSize: 14, fontWeight: '700' },
  secondaryLabel: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18 },
} satisfies Record<string, TextStyle>;
