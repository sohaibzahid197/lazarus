/**
 * Reminder_Texts: the gateway's reminder replies in each Language. Pure data.
 *
 * Rules (checked by tests, Requirement 9): no item is empty or has a newline,
 * `en` and `roman-ur` items are GSM-7 basic only, `ur` items are Urdu script
 * plus digits, spaces, punctuation and keywords, and every item except
 * `timeHelp` (1 or 2 parts) and `deliveryLead` fits 1 SMS part. Every REMIND,
 * LIST or CANCEL keyword in an item routes to that Command in its Language.
 * Examples are kept as data so tests route and parse the exact strings sent.
 */
import type { Language } from './router.types.js';
import type { ReminderSlot } from './reminder.types.js';

export interface ReminderTexts {
  /** Reminder_Set_Text; `when` comes from `formatWhen` (5.2). */
  readonly set: (slot: ReminderSlot, when: string) => string;
  /** Time_Help_Text (5.3, 9.4). */
  readonly timeHelp: string;
  /** Example REMIND messages; each appears verbatim in `timeHelp` (9.4, 9.5). */
  readonly timeHelpExamples: readonly string[];
  /** Past_Time_Text. */
  readonly past: string;
  /** Too_Far_Text; states the 30-day limit (5.7). */
  readonly tooFar: string;
  /** Too_Long_Text; states the 140-character limit (5.5). */
  readonly tooLong: string;
  /** Reminder_Limit_Text; states the limit of 5 and names LIST and CANCEL (5.8). */
  readonly limit: string;
  /** No_Reminders_Text. */
  readonly noReminders: string;
  /** Reminder_Cancelled_Text. */
  readonly cancelled: (slot: ReminderSlot) => string;
  /** No_Such_Reminder_Text; names LIST (7.3). */
  readonly noSuch: string;
  /** Cancel_Usage_Text; shows `CANCEL n` and names LIST (7.4). */
  readonly cancelUsage: string;
  /** A `CANCEL n` example that appears verbatim in `cancelUsage` (9.6). */
  readonly cancelExample: string;
  /** Reminders_Unavailable_Text. */
  readonly unavailable: string;
  /** Lead-in of the Reminder_Delivery_Text, followed by the Reminder_Text. */
  readonly deliveryLead: string;
  /** Lead-in of the List_Formatter reply. */
  readonly listLead: string;
  /** 12 month names, January first, used by `formatWhen`. */
  readonly months: readonly string[];
}

const EN_EXAMPLES = [
  'REMIND 8pm take medicine',
  'REMIND tomorrow 9am call Ali',
  'REMIND in 2 hours drink water',
] as const;

const EN_TEXTS: ReminderTexts = {
  set: (n, when) =>
    `Reminder ${n} set for ${when} Pakistan time. LIST shows all, CANCEL ${n} removes it.`,
  timeHelp: `Sorry, I could not read the time. Try: ${EN_EXAMPLES.join(', ')}`,
  timeHelpExamples: EN_EXAMPLES,
  past: 'That time has already passed today. Try a later time or tomorrow.',
  tooFar: 'Reminders can be set up to 30 days ahead. Please pick an earlier time.',
  tooLong: 'Reminder text is too long. Please keep it under 140 characters.',
  limit: 'You already have 5 reminders. Text LIST to see them or CANCEL and a number to remove one.',
  noReminders: 'You have no reminders. Set one like this: REMIND 8pm take medicine',
  cancelled: (n) => `Reminder ${n} cancelled.`,
  noSuch: 'No reminder with that number. Text LIST to see your reminders.',
  cancelUsage: 'Send CANCEL and the reminder number, for example CANCEL 1. Text LIST to see the numbers.',
  cancelExample: 'CANCEL 1',
  unavailable: 'Reminders are not working right now. Please try again later.',
  deliveryLead: 'Reminder: ',
  listLead: 'Your reminders: ',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const ROMAN_UR_EXAMPLES = [
  'YAAD 8pm dawai leni hai',
  'YAAD kal subah 9 dawai',
  'YAAD 2 ghante baad pani piyen',
] as const;

const ROMAN_UR_TEXTS: ReminderTexts = {
  set: (n, when) =>
    `Yaad dahani ${n} lag gayi: ${when} Pakistan waqt. FEHRIST se sab dekhein, MANSOOKH ${n} se hatayein.`,
  timeHelp: `Waqt samajh nahi aaya. Maslan: ${ROMAN_UR_EXAMPLES.join(', ')}`,
  timeHelpExamples: ROMAN_UR_EXAMPLES,
  past: 'Yeh waqt aaj guzar chuka hai. Baad ka waqt ya kal likhein.',
  tooFar: 'Yaad dahani sirf 30 din tak lag sakti hai. Pehle ka waqt likhein.',
  tooLong: 'Baat bohat lambi hai. 140 huroof tak rakhein.',
  limit: 'Aap ki 5 yaad dahaniyan pehle se hain. FEHRIST se dekhein ya MANSOOKH aur number se hatayein.',
  noReminders: 'Aap ki koi yaad dahani nahi. Maslan: YAAD 8pm dawai leni hai',
  cancelled: (n) => `Yaad dahani ${n} mansookh ho gayi.`,
  noSuch: 'Is number ki yaad dahani nahi. FEHRIST likh kar dekhein.',
  cancelUsage: 'MANSOOKH aur number bhejein, maslan MANSOOKH 1. Number FEHRIST se dekhein.',
  cancelExample: 'MANSOOKH 1',
  unavailable: 'Yaad dahani abhi kaam nahi kar rahi. Thori dair baad koshish karein.',
  deliveryLead: 'Yaad dahani: ',
  listLead: 'Aap ki yaad dahaniyan: ',
  months: EN_TEXTS.months,
};

const UR_EXAMPLES = [
  'یاد شام کو دوا لینی ہے',
  'یاد کل صبح 9 دوا',
  'یاد 2 گھنٹے بعد پانی پیئیں',
] as const;

const UR_TEXTS: ReminderTexts = {
  set: (n, when) => `یاد دہانی ${n} لگی: ${when}۔ فہرست سے دیکھیں، منسوخ ${n} سے ہٹائیں۔`,
  timeHelp: `وقت سمجھ نہیں آیا۔ مثلاً: ${UR_EXAMPLES.join('، ')}`,
  timeHelpExamples: UR_EXAMPLES,
  past: 'یہ وقت آج گزر چکا ہے۔ بعد کا وقت یا کل لکھیں۔',
  tooFar: 'یاد دہانی صرف 30 دن تک لگ سکتی ہے۔ پہلے کا وقت لکھیں۔',
  tooLong: 'بات بہت لمبی ہے۔ 140 حروف تک رکھیں۔',
  limit: '5 یاد دہانیوں کی حد پوری ہے۔ فہرست دیکھیں یا منسوخ اور نمبر سے ہٹائیں۔',
  noReminders: 'آپ کی کوئی یاد دہانی نہیں۔ مثلاً: یاد شام کو دوا لینی ہے',
  cancelled: (n) => `یاد دہانی ${n} منسوخ ہو گئی۔`,
  noSuch: 'اس نمبر کی یاد دہانی نہیں۔ فہرست لکھ کر دیکھیں۔',
  cancelUsage: 'منسوخ اور نمبر بھیجیں، مثلاً منسوخ 1۔ نمبر فہرست سے دیکھیں۔',
  cancelExample: 'منسوخ 1',
  unavailable: 'یاد دہانی ابھی کام نہیں کر رہی۔ کچھ دیر بعد کوشش کریں۔',
  deliveryLead: 'یاد دہانی: ',
  listLead: 'آپ کی یاد دہانیاں: ',
  months: [
    'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون',
    'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
  ],
};

/** Reminder_Texts by Language (Requirement 9). */
export const REMINDER_TEXTS: Readonly<Record<Language, ReminderTexts>> = {
  en: EN_TEXTS,
  'roman-ur': ROMAN_UR_TEXTS,
  ur: UR_TEXTS,
};
