import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it('returns en for plain English (Req 6.3, 9.4)', () => {
    expect(detectLanguage('What is the weather today?')).toBe('en');
  });

  it('returns ur for Urdu script, even mixed with Latin words (Req 6.1, 9.4)', () => {
    expect(detectLanguage('آج موسم کیسا ہے')).toBe('ur');
    expect(detectLanguage('hello kya آج 123')).toBe('ur');
  });

  it('returns roman-ur for Roman Urdu text (Req 6.2, 9.4)', () => {
    expect(detectLanguage('aap kaise hain')).toBe('roman-ur');
  });

  it('returns en for empty and whitespace-only input (Req 6.4)', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('   \t\n  ')).toBe('en');
  });

  it('matches markers case-insensitively (Req 6.6)', () => {
    expect(detectLanguage('KYA hal HAI')).toBe('roman-ur');
    expect(detectLanguage('  MADAD')).toBe('roman-ur');
  });

  it('does not match a marker inside a longer word (Req 6.7)', () => {
    expect(detectLanguage('okay kyaking maintain karate')).toBe('en');
  });
});
