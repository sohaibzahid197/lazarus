/**
 * Fixed texts, keyword lists and constants for the Answer_Service. Pure data.
 *
 * Rules (checked by tests): `ur` texts use Urdu script only, `roman-ur` texts
 * use Latin letters only, no text has a newline, every tryLater fits 1 SMS
 * part, and no referral or uncertainty note is a substring of another text.
 */
import type { Language } from './router.types.js';
import type { ScamVerdict, Topic } from './answer.types.js';

/** Preferred reply size in SMS parts, stated to the model. */
export const TARGET_PARTS = 3;
/** Questions are truncated to this many code points before the Prompt. */
export const MAX_QUESTION_CODE_POINTS = 500;
/** Upper bound on a Scam_Result Reason. */
export const MAX_REASON_CODE_POINTS = 120;
/** Cache time-to-live: 24 hours. */
export const CACHE_TTL_MS = 86_400_000;
/** Default capacity of the memory cache. */
export const CACHE_MAX_ENTRIES = 500;
/** Per-call AI timeout. */
export const CALL_TIMEOUT_MS = 8_000;
/** Copied run length from the system instruction that counts as a leak. */
export const LEAK_RUN_LENGTH = 40;
/** Placeholder for redacted secrets. */
export const REDACTED = '[redacted]';
/** Delimiters around sender text in the user content: ⟦USER⟧ and ⟦/USER⟧. */
export const OPEN_DELIMITER = '\u27E6USER\u27E7';
export const CLOSE_DELIMITER = '\u27E6/USER\u27E7';

export interface FixedTexts {
  readonly tryLater: string;
  readonly promptForQuestion: string;
  readonly promptForScamText: string;
  readonly uncertainty: string;
  readonly referral: Readonly<Record<Topic, string>>;
  readonly scamWord: Readonly<Record<ScamVerdict, string>>;
  readonly scamReason: Readonly<Record<ScamVerdict | 'unparseable', string>>;
}

const EN_TEXTS: FixedTexts = {
  tryLater: 'Sorry, the service is busy. Please try again later.',
  promptForQuestion: 'Please type your question and send it again.',
  promptForScamText: 'Please send SCAM and then the message you want checked.',
  uncertainty: 'This may be wrong or out of date, so please check locally.',
  referral: {
    health: 'Please see a doctor about your case.',
    legal: 'Please ask a lawyer about your case.',
    money: 'Please ask a trusted money adviser before you decide.',
  },
  scamWord: { SCAM: 'SCAM', SAFE: 'SAFE', UNSURE: 'UNSURE' },
  scamReason: {
    SCAM: 'It shows common scam signs. Do not reply or share any code.',
    SAFE: 'No clear scam signs, but stay careful.',
    UNSURE: 'Hard to be sure. Never share your PIN or OTP.',
    unparseable: 'Could not check this message. Never share your PIN or OTP.',
  },
};

const ROMAN_UR_TEXTS: FixedTexts = {
  tryLater: 'Maaf kijiye, service abhi masroof hai. Thori dair baad dobara koshish karein.',
  promptForQuestion: 'Apna sawal likh kar dobara bhejein.',
  promptForScamText: 'DHOKA likh kar uske baad woh paigham bhejein jo check karwana hai.',
  uncertainty: 'Yeh jawab ghalat ya purana ho sakta hai, apne ilaqe mein tasdeeq karein.',
  referral: {
    health: 'Apne masle ke liye doctor se mashwara karein.',
    legal: 'Apne masle ke liye wakeel se mashwara karein.',
    money: 'Faisla karne se pehle kisi bharosemand maali mushir se poochein.',
  },
  scamWord: { SCAM: 'DHOKA', SAFE: 'MEHFOOZ', UNSURE: 'YAQEEN NAHI' },
  scamReason: {
    SCAM: 'Is mein dhokay ki aam nishaniyan hain. Jawab na dein aur code na batayein.',
    SAFE: 'Dhokay ki wazeh nishani nahi, phir bhi hoshiyar rahein.',
    UNSURE: 'Pakka kehna mushkil hai. Apna PIN ya OTP kisi ko na batayein.',
    unparseable: 'Yeh paigham check nahi ho saka. Apna PIN ya OTP kisi ko na batayein.',
  },
};

const UR_TEXTS: FixedTexts = {
  tryLater: 'معاف کیجیے، سروس ابھی مصروف ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
  promptForQuestion: 'اپنا سوال لکھ کر دوبارہ بھیجیں۔',
  promptForScamText: 'دھوکہ لکھ کر اس کے بعد وہ پیغام بھیجیں جو جانچنا ہے۔',
  uncertainty: 'یہ جواب غلط یا پرانا ہو سکتا ہے، اپنے علاقے میں تصدیق کریں۔',
  referral: {
    health: 'اپنے مسئلے کے لیے ڈاکٹر سے مشورہ کریں۔',
    legal: 'اپنے مسئلے کے لیے وکیل سے مشورہ کریں۔',
    money: 'فیصلے سے پہلے کسی قابل اعتماد مالی مشیر سے پوچھیں۔',
  },
  scamWord: { SCAM: 'دھوکہ', SAFE: 'محفوظ', UNSURE: 'یقین نہیں' },
  scamReason: {
    SCAM: 'اس میں دھوکے کی عام نشانیاں ہیں۔ جواب نہ دیں اور کوڈ نہ بتائیں۔',
    SAFE: 'دھوکے کی واضح نشانی نہیں، پھر بھی محتاط رہیں۔',
    UNSURE: 'پکا کہنا مشکل ہے۔ اپنا پن یا کوڈ کسی کو نہ بتائیں۔',
    unparseable: 'یہ پیغام جانچا نہیں جا سکا۔ اپنا پن یا کوڈ کسی کو نہ بتائیں۔',
  },
};

export const FIXED_TEXTS: Readonly<Record<Language, FixedTexts>> = {
  en: EN_TEXTS,
  'roman-ur': ROMAN_UR_TEXTS,
  ur: UR_TEXTS,
};

/**
 * Sensitive-topic keywords. Latin keywords are lower case and match as whole
 * words; Urdu-script keywords match as substrings.
 */
export const TOPIC_KEYWORDS: Readonly<Record<Language, Readonly<Record<Topic, readonly string[]>>>> = {
  en: {
    health: [
      'doctor', 'medicine', 'medicines', 'fever', 'pain', 'sick', 'illness', 'disease',
      'hospital', 'dose', 'dosage', 'tablet', 'pregnant', 'pregnancy', 'blood pressure',
      'diabetes', 'injury', 'infection', 'cough', 'health',
    ],
    legal: [
      'lawyer', 'court', 'law', 'legal', 'police', 'divorce', 'property dispute',
      'contract', 'arrest', 'fir', 'inheritance', 'lawsuit',
    ],
    money: [
      'loan', 'loans', 'tax', 'taxes', 'invest', 'investment', 'investing', 'insurance',
      'bank', 'interest', 'debt', 'savings', 'shares', 'stock', 'crypto', 'money',
    ],
  },
  'roman-ur': {
    health: ['dawai', 'dawa', 'bukhar', 'dard', 'bimari', 'beemari', 'hospital', 'ilaj', 'ilaaj', 'hakeem', 'sehat'],
    legal: ['wakeel', 'wakil', 'adalat', 'qanoon', 'qanooni', 'muqadma', 'mukadma', 'talaq', 'virasat'],
    money: ['qarz', 'qarza', 'sood', 'beema', 'bima', 'paisa', 'paise', 'paisay', 'sarmaya', 'qist', 'kameti'],
  },
  ur: {
    health: ['ڈاکٹر', 'دوا', 'بخار', 'درد', 'بیماری', 'ہسپتال', 'علاج', 'حکیم', 'صحت'],
    legal: ['وکیل', 'عدالت', 'قانون', 'مقدمہ', 'پولیس', 'طلاق', 'وراثت'],
    money: ['قرض', 'سود', 'ٹیکس', 'بینک', 'بنک', 'بیمہ', 'سرمایہ', 'قسط', 'کمیٹی', 'پیسے'],
  },
};

/** Price and rate keywords (subset of live facts). */
export const PRICE_KEYWORDS: Readonly<Record<Language, readonly string[]>> = {
  en: ['price', 'prices', 'rate', 'rates', 'exchange rate', 'cost', 'dollar rate', 'gold rate'],
  'roman-ur': ['qeemat', 'keemat', 'bhao', 'bhaav', 'rate', 'daam', 'nirkh'],
  ur: ['قیمت', 'ریٹ', 'بھاؤ', 'نرخ', 'دام'],
};

/** Live-fact keywords: prices and rates plus weather, scores and news. */
export const LIVE_FACT_KEYWORDS: Readonly<Record<Language, readonly string[]>> = {
  en: [...PRICE_KEYWORDS.en, 'weather', 'rain', 'forecast', 'score', 'scores', 'news'],
  'roman-ur': [...PRICE_KEYWORDS['roman-ur'], 'mausam', 'barish', 'score', 'khabar', 'khabrein'],
  ur: [...PRICE_KEYWORDS.ur, 'موسم', 'بارش', 'اسکور', 'سکور', 'خبر'],
};
