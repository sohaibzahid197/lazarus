/**
 * Theme tokens and accessibility checks (Requirements 17.8, 17.9).
 */
import {
  colors,
  contrastRatio,
  fontMin,
  fontSize,
  radius,
  relativeLuminance,
  spacing,
  spacingScale,
  textPairs,
  typography,
} from '../src/ui/theme';

const ALLOWED_SPACING: readonly number[] = [4, 8, 12, 16, 24, 32];

describe('theme tokens', () => {
  it('colours equal the design tokens exactly', () => {
    expect(colors).toEqual({
      bg: '#0B0F0C',
      surface: '#141A16',
      text: '#E6F2E9',
      muted: '#8FA396',
      soul: '#39FF88',
      ember: '#FFB347',
      blood: '#FF4D5E',
    });
  });

  it('radius is 14', () => {
    expect(radius).toBe(14);
  });

  it('spacing scale is 4/8/12/16/24/32', () => {
    expect([...spacingScale]).toEqual(ALLOWED_SPACING);
    for (const value of Object.values(spacing)) {
      expect(ALLOWED_SPACING).toContain(value);
    }
  });

  it('every font size is at least 16', () => {
    expect(fontMin).toBe(16);
    for (const size of Object.values(fontSize)) {
      expect(size).toBeGreaterThanOrEqual(16);
    }
    for (const style of Object.values(typography)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('contrast', () => {
  it('every text/background pair used has contrast of at least 4.5:1', () => {
    expect(textPairs.length).toBeGreaterThan(0);
    for (const { fg, bg } of textPairs) {
      const ratio = contrastRatio(colors[fg], colors[bg]);
      if (ratio < 4.5) {
        throw new Error(`${fg} on ${bg} has contrast ${ratio.toFixed(2)}:1`);
      }
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('contrastRatio gives 21 for black/white and 1 for the same colour', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#39FF88', '#39FF88')).toBeCloseTo(1, 10);
  });

  it('relativeLuminance gives 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('relativeLuminance throws on bad input', () => {
    for (const bad of ['', '#FFF', 'FFFFFF', '#GGGGGG', '#1234567', 'red']) {
      expect(() => relativeLuminance(bad)).toThrow();
    }
  });
});
