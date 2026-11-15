/**
 * Design tokens from `.kiro/steering/design.md` (Requirements 17.8, 17.9).
 * Screens take every colour, radius, spacing value and font size from here.
 */

export const colors = {
  bg: '#0B0F0C',
  surface: '#141A16',
  text: '#E6F2E9',
  muted: '#8FA396',
  /** Alive / success. */
  soul: '#39FF88',
  /** Sending. */
  ember: '#FFB347',
  /** Error. */
  blood: '#FF4D5E',
} as const;

export type ColorName = keyof typeof colors;

/** Corner radius for every rounded element. */
export const radius = 14;

/** The only allowed padding, margin and gap values. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const spacingScale: readonly number[] = Object.values(spacing);

/** Smallest font size any text may use, in sp. */
export const fontMin = 16;

export const fontSize = {
  min: fontMin,
  body: 16,
  label: 18,
  title: 24,
  display: 32,
} as const;

/**
 * Body uses the system UI font. Headings use one display family that ships
 * with Android ('serif', Noto Serif), so no font file is bundled.
 */
export const typography = {
  body: { fontFamily: 'sans-serif', fontSize: fontSize.body },
  label: { fontFamily: 'sans-serif', fontSize: fontSize.label, fontWeight: '600' },
  title: { fontFamily: 'serif', fontSize: fontSize.title, fontWeight: '700' },
  display: { fontFamily: 'serif', fontSize: fontSize.display, fontWeight: '700' },
} as const;

export type TextPair = {
  readonly fg: ColorName;
  readonly bg: ColorName;
};

/**
 * Every text colour on background colour combination the UI uses. All pass
 * 4.5:1 (lowest: blood on surface, about 5.45:1). Button labels use `bg`
 * text on a `soul` fill (about 14.5:1). A pair below 4.5:1 must not be added
 * here; leave it out and do not change the tokens.
 */
export const textPairs: readonly TextPair[] = [
  { fg: 'text', bg: 'bg' },
  { fg: 'text', bg: 'surface' },
  { fg: 'muted', bg: 'bg' },
  { fg: 'muted', bg: 'surface' },
  { fg: 'soul', bg: 'bg' },
  { fg: 'soul', bg: 'surface' },
  { fg: 'ember', bg: 'bg' },
  { fg: 'ember', bg: 'surface' },
  { fg: 'blood', bg: 'bg' },
  { fg: 'blood', bg: 'surface' },
  { fg: 'bg', bg: 'soul' },
];

function channelToLinear(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Expected #RRGGBB colour, got "${hex}"`);
  }
  const r = channelToLinear(parseInt(hex.slice(1, 3), 16));
  const g = channelToLinear(parseInt(hex.slice(3, 5), 16));
  const b = channelToLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours, from 1 to 21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
