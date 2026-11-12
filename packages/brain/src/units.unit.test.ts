// Unit tests for the SMS code-unit counting module.
//
// Example-based tests covering GSM-7 weights, UCS-2 length counting and
// the surrogate predicates. Each test references the requirement clause
// it validates.

import { describe, it, expect } from 'vitest';
import {
  countCodeUnits,
  gsm7CharWeight,
  isHighSurrogate,
  isLowSurrogate,
} from './units.js';

// _Requirements: 5.1_
//
// Requirement 5.1: SMS capacity is measured in code units. GSM-7 basic
// characters cost 1, GSM-7 extension characters cost 2, and UCS-2 counts
// UTF-16 code units (so a supplementary character costs 2).
describe('SMS Message Splitter — code units (unit)', () => {
  // --- gsm7CharWeight ---------------------------------------------------

  it('weights a basic GSM-7 character as 1', () => {
    expect(gsm7CharWeight('a')).toBe(1);
  });

  it('weights GSM-7 extension characters as 2', () => {
    expect(gsm7CharWeight('^')).toBe(2);
    expect(gsm7CharWeight('€')).toBe(2);
  });

  // --- countCodeUnits (GSM-7) -------------------------------------------

  it('counts basic GSM-7 characters as 1 each', () => {
    expect(countCodeUnits('abc', 'GSM-7')).toBe(3);
  });

  it('counts extension GSM-7 characters as 2 each', () => {
    expect(countCodeUnits('^€', 'GSM-7')).toBe(4);
  });

  it('counts a mix of basic and extension characters', () => {
    expect(countCodeUnits('a^b', 'GSM-7')).toBe(4);
  });

  it('counts an empty string as 0', () => {
    expect(countCodeUnits('', 'GSM-7')).toBe(0);
    expect(countCodeUnits('', 'UCS-2')).toBe(0);
  });

  // --- countCodeUnits (UCS-2) -------------------------------------------

  it('counts a supplementary emoji as 2 code units in UCS-2', () => {
    expect(countCodeUnits('😀', 'UCS-2')).toBe(2);
  });

  it('counts BMP non-GSM characters as 1 each in UCS-2', () => {
    expect(countCodeUnits('اب', 'UCS-2')).toBe(2);
  });

  it('counts an emoji followed by a basic character as 3 in UCS-2', () => {
    expect(countCodeUnits('😀a', 'UCS-2')).toBe(3);
  });

  // --- surrogate predicates ---------------------------------------------

  it('identifies high surrogate boundaries', () => {
    expect(isHighSurrogate(0xd800)).toBe(true);
    expect(isHighSurrogate(0xdbff)).toBe(true);
    expect(isHighSurrogate(0xd7ff)).toBe(false);
    expect(isHighSurrogate(0xdc00)).toBe(false);
  });

  it('identifies low surrogate boundaries', () => {
    expect(isLowSurrogate(0xdc00)).toBe(true);
    expect(isLowSurrogate(0xdfff)).toBe(true);
    expect(isLowSurrogate(0xdbff)).toBe(false);
    expect(isLowSurrogate(0xe000)).toBe(false);
  });

  it('classifies the two code units of an emoji as high then low', () => {
    const emoji = '😀';
    expect(isHighSurrogate(emoji.charCodeAt(0))).toBe(true);
    expect(isLowSurrogate(emoji.charCodeAt(1))).toBe(true);
  });
});
