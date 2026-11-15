/**
 * Fixed_Gateway_Texts: the gateway's own replies in each Language. Pure data.
 *
 * Rules (checked by tests): no text has a newline, `en` and `roman-ur` texts
 * are GSM-7, `ur` texts are Urdu script, every text fits 1 SMS part (the `ur`
 * Help_Text at most 2), and each text uses the keywords ALIAS_TABLE knows in
 * its Language. A LIST or CANCEL keyword (`list`, `fehrist`, `فہرست`, ...)
 * appears only as that keyword. The Help_Text names REMIND as available and
 * keeps TRANSLATE "coming soon". Each usage hint starts with its own keyword,
 * so the hint and its example both route to that Command.
 */
import type { Language } from './router.types.js';

export interface GatewayTexts {
  readonly help: string;
  readonly slowDown: string;
  readonly welcomeBack: string;
  readonly notAvailable: string;
  readonly usage: Readonly<Record<'SCAM' | 'REMIND' | 'TRANSLATE', string>>;
}

const EN_TEXTS: GatewayTexts = {
  help:
    'Lazarus: text any question. SCAM <msg> checks a msg. REMIND 8pm <text> sets a reminder, ' +
    'LIST shows them. STOP ends texts, START resumes. TRANSLATE coming soon.',
  slowDown: 'You sent many messages. Please wait a little and try again later.',
  welcomeBack: 'Welcome back! You will get replies again. Text any question, or HELP for commands.',
  notAvailable: 'Sorry, this is not ready yet. Text any question, or HELP for commands.',
  usage: {
    SCAM: 'SCAM <message>, for example: SCAM You won a prize, call now',
    REMIND: 'REMIND <time> <text>, for example: REMIND 6pm take medicine',
    TRANSLATE: 'TRANSLATE <text>, for example: TRANSLATE good morning',
  },
};

const ROMAN_UR_TEXTS: GatewayTexts = {
  help:
    'Lazarus: koi bhi sawal bhejein. DHOKA <paigham> se check. YAAD 8pm <baat> se yaad dahani, ' +
    'FEHRIST se dekhein. BAND se band, SHURU se dobara. TARJUMA jald.',
  slowDown: 'Aap ne bohat paigham bheje hain. Thori dair baad dobara koshish karein.',
  welcomeBack: 'Khush aamdeed! Ab aap ko dobara jawab milenge. Koi bhi sawal bhejein, ya MADAD likhein.',
  notAvailable: 'Maaf kijiye, yeh abhi tayyar nahi. Koi bhi sawal bhejein, ya MADAD likhein.',
  usage: {
    SCAM: 'DHOKA <paigham>, maslan: DHOKA Aap ka inaam nikla hai, abhi call karein',
    REMIND: 'YAAD <waqt> <baat>, maslan: YAAD 6pm dawai leni hai',
    TRANSLATE: 'TARJUMA <baat>, maslan: TARJUMA good morning',
  },
};

const UR_TEXTS: GatewayTexts = {
  help:
    'سوال بھیجیں۔ دھوکہ اور پیغام سے جانچ۔ یاد، وقت، بات سے یاد دہانی، فہرست سے دیکھیں۔ ' +
    'بند سے بند، شروع سے پھر۔ ترجمہ جلد۔',
  slowDown: 'آپ نے بہت پیغام بھیجے ہیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
  welcomeBack: 'خوش آمدید! اب آپ کو دوبارہ جواب ملیں گے۔ مدد لکھ کر فہرست دیکھیں۔',
  notAvailable: 'معاف کیجیے، یہ ابھی تیار نہیں۔ کوئی سوال بھیجیں یا مدد لکھیں۔',
  usage: {
    SCAM: 'دھوکہ اور پھر پیغام، مثلاً: دھوکہ آپ کا انعام نکلا ہے',
    REMIND: 'یاد اور پھر وقت اور بات، مثلاً: یاد شام کو دوا لینی ہے',
    TRANSLATE: 'ترجمہ اور پھر بات، مثلاً: ترجمہ صبح بخیر',
  },
};

export const GATEWAY_TEXTS: Readonly<Record<Language, GatewayTexts>> = {
  en: EN_TEXTS,
  ur: UR_TEXTS,
  'roman-ur': ROMAN_UR_TEXTS,
};
