import { describe, expect, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import {
  KEYWORD_TRAILING_PUNCTUATION,
  STOP_ALIAS_LIST,
  STOP_MARKER,
  stopAliasAsset,
  stopKeywordCheck,
} from './stopAliases.js';

// Validates: Requirements 9.13, 17.7, 18.13

describe('STOP_ALIAS_LIST', () => {
  it('deep-equals the ALIAS_TABLE keys that map to STOP, in table order', () => {
    const expected = [...ALIAS_TABLE.entries()]
      .filter(([, command]) => command === 'STOP')
      .map(([alias]) => alias);
    expect(STOP_ALIAS_LIST).toEqual(expected);
    expect(STOP_ALIAS_LIST).toEqual(['stop', 'band', 'بند']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(STOP_ALIAS_LIST)).toBe(true);
  });
});

describe('stopAliasAsset', () => {
  it('has the asset shape the Kotlin check reads', () => {
    expect(stopAliasAsset()).toEqual({
      v: 1,
      aliases: ['stop', 'band', 'بند'],
      trailingPunctuation: KEYWORD_TRAILING_PUNCTUATION,
      stopMarker: STOP_MARKER,
    });
    expect(KEYWORD_TRAILING_PUNCTUATION).toBe('.,!?:;');
    expect(STOP_MARKER).toBe('STOP');
  });

  it('returns a fresh object whose aliases are a copy of the list', () => {
    const a = stopAliasAsset();
    const b = stopAliasAsset();
    expect(a).not.toBe(b);
    expect(a.aliases).not.toBe(STOP_ALIAS_LIST);
  });
});

describe('stopKeywordCheck', () => {
  it.each(['STOP', 'stop!', 'Band.', 'بند', '  STOP please'])('accepts %j', (body) => {
    expect(stopKeywordCheck(body)).toBe(true);
  });

  it.each(['STOPPED', '!!! stop', 'please stop', '', 'ＳＴＯＰ'])('rejects %j', (body) => {
    expect(stopKeywordCheck(body)).toBe(false);
  });
});
