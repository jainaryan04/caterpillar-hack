import type { TextStyle } from 'react-native';

/**
 * Design tokens for the Operator app.
 *
 * Values are taken from the Supervisor dashboard (frontend/src/app/globals.css,
 * dark theme) so both apps read as one product. Rules carried over from
 * frontend/docs/DESIGN_SPEC.md:
 *  - Brand yellow means "act here" (primary action, current task, active tab).
 *    It is never used as a status colour.
 *  - Status is never shown by colour alone: always pair it with an icon + label.
 *  - Red is reserved for critical / emergency states.
 */

export const colors = {
  // Surfaces
  canvas: '#0B0B0B',
  panel: '#161616',
  raised: '#1E1E1E',
  overlay: '#242424',
  inset: '#101010',
  border: '#2A2A2A',
  borderStrong: '#3A3A3A',

  // Text
  text: '#F5F5F5',
  textSecondary: '#A3A3A3',
  textMuted: '#8A8A8A',
  textDisabled: '#525252',

  // Brand
  brand: '#FFCD11',
  brandPressed: '#E6B800',
  brandSubtle: 'rgba(255,205,17,0.10)',
  brandBorder: 'rgba(255,205,17,0.35)',
  onBrand: '#111111',

  // Status
  success: '#22C55E',
  successSubtle: 'rgba(34,197,94,0.12)',
  warning: '#F59E0B',
  warningSubtle: 'rgba(245,158,11,0.12)',
  danger: '#EF4444',
  dangerSubtle: 'rgba(239,68,68,0.12)',
  dangerStrong: '#B91C1C',
  info: '#3B82F6',
  infoSubtle: 'rgba(59,130,246,0.12)',
  neutral: '#737373',
  neutralSubtle: 'rgba(115,115,115,0.16)',

  scrim: 'rgba(0,0,0,0.72)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Small radii on purpose: the Supervisor UI uses 6px corners, not pills. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  round: 999,
} as const;

/** Minimum touch target. Field operators may be wearing gloves. */
export const touch = {
  min: 48,
  large: 56,
} as const;

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_500Medium',
} as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: 0.2 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  /** Uppercase section labels, like the Supervisor panel headers. */
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1.2 },
  mono: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  monoLarge: { fontFamily: fonts.mono, fontSize: 20, lineHeight: 26, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
