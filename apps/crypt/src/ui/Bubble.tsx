// One bubble of the Phone_Screen thread (Requirements 2.4, 2.7, 11.2–11.4, 13.7, 16.7).
// Text is shown exactly as received: no trimming, truncation or added text.
import type { Bubble as BubbleData, PartBadge } from '../session/session.types';
import { CONTROL_LABELS } from './texts';
import { hasUrdu, textDirection } from './direction';

/** Part_Badge text, for example `Part 1 of 2 · GSM-7 · 148/153` (Requirement 11.2). */
export function badgeText(badge: PartBadge): string {
  return `Part ${String(badge.n)} of ${String(badge.total)} · ${badge.encoding} · ${String(badge.units)}/${String(badge.limit)}`;
}

/** The label shown above a first part: its Language, or `Reminder` for a delivery. */
export function bubbleLabel(bubble: BubbleData): string | null {
  if (bubble.kind === 'reminder-part' && bubble.reminderLabel === true) return CONTROL_LABELS.reminderLabel;
  if (bubble.kind === 'part' && bubble.languageLabel !== undefined) return bubble.languageLabel;
  return null;
}

/** Text the Announcer reads for a bubble, or null for bubbles that are not announced (outgoing). */
export function announcementFor(bubble: BubbleData): string | null {
  if (bubble.kind === 'outgoing') return null;
  if (bubble.kind === 'note') return bubble.text;
  const parts: string[] = [];
  if (bubble.kind === 'reminder-part' && bubble.reminderLabel === true) parts.push(CONTROL_LABELS.reminderLabel);
  parts.push(bubble.text);
  if (bubble.badge !== undefined) parts.push(badgeText(bubble.badge));
  return parts.join('. ');
}

export interface BubbleProps {
  readonly bubble: BubbleData;
}

export function Bubble({ bubble }: BubbleProps) {
  const label = bubbleLabel(bubble);
  const urdu = hasUrdu(bubble.text);
  return (
    <div className={`bubble bubble--${bubble.kind}`} data-bubble-kind={bubble.kind}>
      {label !== null && <span className="bubble__label">{label}</span>}
      <p className="bubble__text" dir={textDirection(bubble.text)} lang={urdu ? 'ur' : undefined}>
        {bubble.text}
      </p>
      {bubble.badge !== undefined && <span className="bubble__badge">{badgeText(bubble.badge)}</span>}
    </div>
  );
}
