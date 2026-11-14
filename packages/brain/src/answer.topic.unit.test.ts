// Unit tests for the Topic_Classifier (`answer.topic.ts`).
// Keywords are taken from the fixed lists in `answer.texts.ts`.
import { describe, it, expect } from 'vitest';
import {
  asksForLiveFacts,
  asksForPriceOrRate,
  classifyTopic,
  containsUnsupportedAmount,
} from './answer.topic.js';

describe('classifyTopic: one keyword per topic and language', () => {
  // Requirements 5.1, 5.5
  it.each([
    ['en', 'I have a fever since yesterday', 'health'],
    ['en', 'Do I need a lawyer for this?', 'legal'],
    ['en', 'How do I get a loan?', 'money'],
    ['ur', 'مجھے بخار ہے کیا کروں', 'health'],
    ['ur', 'وکیل کیسے ڈھونڈوں', 'legal'],
    ['ur', 'قرض کیسے ملے گا', 'money'],
    ['roman-ur', 'mujhe bukhar hai kya karun', 'health'],
    ['roman-ur', 'wakeel kaise milega', 'legal'],
    ['roman-ur', 'qarz kaise milega', 'money'],
  ] as const)('%s: "%s" is %s', (language, text, topic) => {
    expect(classifyTopic(text, language)).toEqual({ sensitive: true, topic });
  });

  it('matches Latin keywords regardless of letter case', () => {
    // Requirement 5.5
    expect(classifyTopic('LOAN please', 'en')).toEqual({ sensitive: true, topic: 'money' });
    expect(classifyTopic('Dawai kab leni hai', 'roman-ur')).toEqual({
      sensitive: true,
      topic: 'health',
    });
  });

  it('matches Latin keywords as whole words only', () => {
    // Requirement 5.5: "fir" must not match inside "first", "law" not inside "lawn"
    expect(classifyTopic('who came first', 'en')).toEqual({ sensitive: false, topic: null });
    expect(classifyTopic('mow the lawn', 'en')).toEqual({ sensitive: false, topic: null });
  });

  it('matches multi-word keywords', () => {
    expect(classifyTopic('my blood pressure is high', 'en')).toEqual({
      sensitive: true,
      topic: 'health',
    });
  });

  it('uses the English list as well for Urdu and Roman Urdu', () => {
    expect(classifyTopic('doctor kab milega', 'roman-ur').topic).toBe('health');
    expect(classifyTopic('bank کب کھلتا ہے', 'ur').topic).toBe('money');
  });

  it('returns not sensitive for ordinary questions and blank input', () => {
    // Requirement 5.1
    const none = { sensitive: false, topic: null };
    expect(classifyTopic('How do I plant wheat?', 'en')).toEqual(none);
    expect(classifyTopic('', 'en')).toEqual(none);
    expect(classifyTopic('   \n ', 'ur')).toEqual(none);
  });
});

describe('classifyTopic: topic priority on mixed text', () => {
  // Requirement 5.1: exactly one topic, priority health > legal > money
  it('prefers health over legal and money', () => {
    expect(classifyTopic('lawyer said take a loan for the hospital', 'en').topic).toBe('health');
  });

  it('prefers legal over money', () => {
    expect(classifyTopic('court case about my loan', 'en').topic).toBe('legal');
    expect(classifyTopic('عدالت میں قرض کا مقدمہ', 'ur').topic).toBe('legal');
    expect(classifyTopic('qarz ka muqadma', 'roman-ur').topic).toBe('legal');
  });

  it('prefers health over money in Urdu script', () => {
    expect(classifyTopic('علاج کے لیے قرض', 'ur').topic).toBe('health');
  });
});

describe('asksForLiveFacts and asksForPriceOrRate', () => {
  // Requirements 6.2, 6.4
  it.each([
    ['en', 'what is the gold rate today'],
    ['en', 'wheat price in Multan'],
    ['ur', 'گندم کی قیمت کیا ہے'],
    ['roman-ur', 'aaj gandum ka bhao kya hai'],
  ] as const)('%s: "%s" asks for a price or rate', (language, text) => {
    expect(asksForPriceOrRate(text, language)).toBe(true);
    expect(asksForLiveFacts(text, language)).toBe(true);
  });

  it.each([
    ['en', 'will it rain tomorrow'],
    ['en', 'latest cricket score'],
    ['en', 'any news today'],
    ['ur', 'کل موسم کیسا ہوگا'],
    ['ur', 'آج کی خبر'],
    ['roman-ur', 'kal mausam kaisa hoga'],
    ['roman-ur', 'aaj ki khabar'],
  ] as const)('%s: "%s" is a live fact but not a price', (language, text) => {
    expect(asksForLiveFacts(text, language)).toBe(true);
    expect(asksForPriceOrRate(text, language)).toBe(false);
  });

  it('is case-insensitive and whole-word for Latin keywords', () => {
    expect(asksForPriceOrRate('PRICE of rice', 'en')).toBe(true);
    // "rate" must not match inside "pirate" or "accurate"
    expect(asksForPriceOrRate('a pirate story, be accurate', 'en')).toBe(false);
  });

  it('returns false for questions without a keyword and for blank input', () => {
    expect(asksForLiveFacts('how do I plant wheat', 'en')).toBe(false);
    expect(asksForLiveFacts('', 'roman-ur')).toBe(false);
    expect(asksForPriceOrRate('  ', 'ur')).toBe(false);
  });
});

describe('containsUnsupportedAmount', () => {
  // Requirement 6.3
  it('flags a Rs amount not in the question', () => {
    expect(containsUnsupportedAmount('It costs Rs 250 per kg.', 'wheat price?')).toBe(true);
    expect(containsUnsupportedAmount('About rs.300 now', 'wheat price?')).toBe(true);
  });

  it('accepts a Rs amount that appears in the question, ignoring thousands separators', () => {
    expect(containsUnsupportedAmount('Rs 1,200 is fair.', 'Is 1200 a fair price?')).toBe(false);
  });

  it('flags a $ amount not in the question', () => {
    expect(containsUnsupportedAmount('The dollar is $3 today', 'dollar rate?')).toBe(true);
    expect(containsUnsupportedAmount('It was $3 then', 'was it 3?')).toBe(false);
  });

  it('flags a percentage not in the question', () => {
    expect(containsUnsupportedAmount('Interest is 12% a year.', 'bank rate?')).toBe(true);
    expect(containsUnsupportedAmount('Yes, 12% is common.', 'Is 12% normal?')).toBe(false);
  });

  it('maps Urdu digits to ASCII before comparing', () => {
    // Extended Arabic-Indic digits in the model text
    expect(containsUnsupportedAmount('قیمت ۲۵۰ روپے ہے', 'is it 250?')).toBe(false);
    expect(containsUnsupportedAmount('قیمت ۳۰۰ روپے ہے', 'is it 250?')).toBe(true);
    // Urdu digits in the question
    expect(containsUnsupportedAmount('Rs 250', 'کیا قیمت ۲۵۰ ہے')).toBe(false);
    // Arabic-Indic digits with a percent sign
    expect(containsUnsupportedAmount('٥% more', 'how much more?')).toBe(true);
  });

  it('ignores numbers without a currency marker or percent sign', () => {
    expect(containsUnsupportedAmount('Water it every 3 days.', 'how often?')).toBe(false);
    expect(containsUnsupportedAmount('Check the local market.', 'price?')).toBe(false);
  });
});
