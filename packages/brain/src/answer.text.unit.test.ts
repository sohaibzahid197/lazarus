// Unit tests for the Answer_Service text helpers.
// _Requirements: 3.3, 3.4, 3.5, 3.8, 11.4_
import { describe, it, expect } from 'vitest';
import {
  fitsSms,
  hasPromptLeak,
  joinReply,
  removeAll,
  shortenToFit,
  smartCut,
  stripMarkdown,
} from './answer.text.js';
import { isHighSurrogate } from './units.js';

/** Longest run of 'a' that still fits in MAX_PARTS parts on its own. */
function longestFittingRun(): string {
  let run = '';
  while (fitsSms(`${run}a`)) {
    run += 'a';
  }
  return run;
}

describe('smartCut', () => {
  it('cuts after the last sentence end in the slice', () => {
    expect(smartCut('Hello there. How are you today', 20)).toBe('Hello there.');
  });

  it('treats Urdu full stop as a sentence end', () => {
    expect(smartCut('بارش ہوگی۔ کل دھوپ ہوگی', 15)).toBe('بارش ہوگی۔');
  });

  it('cuts at the last space within the final 15 units when no sentence end exists', () => {
    const text = `${'a'.repeat(20)} ${'b'.repeat(20)}`;
    expect(smartCut(text, 30)).toBe('a'.repeat(20));
  });

  it('uses a space exactly 15 units before the limit but not 16', () => {
    const at15 = `${'a'.repeat(15)} ${'b'.repeat(30)}`;
    expect(smartCut(at15, 30)).toBe('a'.repeat(15));
    const at14 = `${'a'.repeat(14)} ${'b'.repeat(30)}`;
    expect(smartCut(at14, 30)).toBe(at14.slice(0, 30));
  });

  it('cuts at the exact limit when there is no sentence end or nearby space', () => {
    expect(smartCut('x'.repeat(50), 20)).toBe('x'.repeat(20));
  });

  it('never cuts inside a surrogate pair', () => {
    const text = `${'a'.repeat(9)}😀b`;
    const cut = smartCut(text, 10);
    expect(cut).toBe('a'.repeat(9));
    expect(isHighSurrogate(cut.charCodeAt(cut.length - 1))).toBe(false);
  });

  it('keeps the whole text when the limit reaches the end', () => {
    expect(smartCut('short text ', 100)).toBe('short text');
  });
});

describe('shortenToFit', () => {
  it('returns model text unchanged when it already fits', () => {
    expect(shortenToFit('Rain is likely tomorrow.', 'See a doctor.')).toBe(
      'Rain is likely tomorrow.',
    );
  });

  it('shrinks only the model text and keeps the suffix intact', () => {
    const model = 'Drink water often. '.repeat(60).trim();
    const suffix = 'Please ask a doctor.';
    const cut = shortenToFit(model, suffix);
    expect(cut.length).toBeGreaterThan(0);
    expect(model.startsWith(cut)).toBe(true);
    expect(cut.endsWith('.')).toBe(true);
    expect(fitsSms(joinReply(cut, suffix))).toBe(true);
  });

  it('shrinks model text to empty when the prefix leaves no room', () => {
    const prefix = longestFittingRun();
    expect(shortenToFit('Hello world.', '', prefix)).toBe('');
  });
});

describe('hasPromptLeak', () => {
  const system = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN';

  it('detects a copied run of exactly 40 characters', () => {
    expect(hasPromptLeak(`xx ${system.slice(5, 45)} yy`, system)).toBe(true);
  });

  it('ignores a copied run of 39 characters', () => {
    expect(hasPromptLeak(`xx ${system.slice(5, 44)} yy`, system)).toBe(false);
  });

  it('checks the whole system text when it is shorter than 40 characters', () => {
    expect(hasPromptLeak('Sure. Be kind and short. Done.', 'Be kind and short.')).toBe(true);
    expect(hasPromptLeak('Sure. Be kind and brief. Done.', 'Be kind and short.')).toBe(false);
  });

  it('never reports a leak for an empty system text', () => {
    expect(hasPromptLeak('anything', '')).toBe(false);
  });
});

describe('removeAll', () => {
  it('removes repeated copies', () => {
    expect(removeAll('xabcyabcabcz', 'abc')).toBe('xyz');
  });

  it('removes copies formed by an earlier removal', () => {
    expect(removeAll('aabcbc', 'abc')).toBe('');
  });

  it('leaves text unchanged for an empty needle', () => {
    expect(removeAll('abc', '')).toBe('abc');
  });
});

describe('stripMarkdown', () => {
  it('removes markers and list prefixes and joins lines', () => {
    expect(stripMarkdown('# Title\n- **bold** item\n1. `code` _x_')).toBe(
      'Title bold item code x',
    );
  });
});
