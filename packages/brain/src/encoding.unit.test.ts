// Unit tests for the SMS encoding-detection module.
//
// Example-based tests covering specific encoding-detection scenarios and
// edge cases that complement the property-based tests. Each test references
// the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import { detectEncoding } from './encoding.js';

// _Requirements: 4.1_
//
// Requirement 4.1: WHEN the Reply_Text contains any non-GSM-7 character,
// the SMS_Splitter SHALL use UCS-2 encoding for the entire Reply_Text.
// detectEncoding is the whole-message classification that drives this.
describe('SMS Message Splitter — encoding detection (unit)', () => {
  // --- GSM-7 cases -------------------------------------------------------

  it('detects pure GSM-7 basic text as GSM-7', () => {
    // Letters, digits, space, and common punctuation from the basic table.
    expect(detectEncoding('Hello World 123')).toBe('GSM-7');
    expect(detectEncoding('Test message! 100% OK?')).toBe('GSM-7');
  });

  it('detects GSM-7 extension-only text as GSM-7', () => {
    // All nine extension characters: ^ { } \ [ ~ ] | €
    expect(detectEncoding('^{}\\[]~|€')).toBe('GSM-7');
  });

  it('detects a single extension character as GSM-7', () => {
    expect(detectEncoding('€')).toBe('GSM-7');
    expect(detectEncoding('^')).toBe('GSM-7');
  });

  it('detects mixed GSM-7 basic and extension text as GSM-7', () => {
    expect(detectEncoding('Price is 5€ and 10^')).toBe('GSM-7');
    expect(detectEncoding('a|b{c}~d')).toBe('GSM-7');
  });

  it('detects an empty string as GSM-7', () => {
    // No characters at all means no non-GSM-7 character is present.
    expect(detectEncoding('')).toBe('GSM-7');
  });

  // --- UCS-2 cases -------------------------------------------------------

  it('detects Urdu characters as UCS-2', () => {
    expect(detectEncoding('السلام')).toBe('UCS-2');
  });

  it('detects emoji (surrogate pair) as UCS-2', () => {
    // 😀 is U+1F600, a supplementary character represented as a UTF-16
    // surrogate pair. detectEncoding iterates by code point, so the emoji
    // is treated as one non-GSM-7 character forcing UCS-2.
    expect(detectEncoding('😀')).toBe('UCS-2');
    expect(detectEncoding('Hello 😀')).toBe('UCS-2');
  });

  it('detects the backtick/grave accent as UCS-2', () => {
    // The backtick is deliberately excluded from the GSM-7 basic alphabet.
    expect(detectEncoding('`')).toBe('UCS-2');
    expect(detectEncoding('Hello `world')).toBe('UCS-2');
  });

  it('detects mixed GSM-7 and non-GSM-7 text as UCS-2', () => {
    // A single non-GSM-7 character forces UCS-2 for the whole message.
    expect(detectEncoding('Hello العالم')).toBe('UCS-2');
    expect(detectEncoding('abc😀123')).toBe('UCS-2');
  });
});
