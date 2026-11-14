/**
 * Redactor: removes configured secrets from text and masks phone numbers in
 * log text. Pure, no I/O.
 */
import { REDACTED } from './answer.texts.js';

const MAX_PASSES = 5;
const PHONE_RUN = /\+?\d(?:[ -]*\d){6,}/g;
const KEEP_LAST_DIGITS = 3;

type Interval = readonly [start: number, end: number];

/** Half-open intervals of every occurrence of `secret`, overlaps included. */
function findOccurrences(text: string, secret: string): Interval[] {
  const found: Interval[] = [];
  let index = text.indexOf(secret);
  while (index !== -1) {
    found.push([index, index + secret.length]);
    index = text.indexOf(secret, index + 1);
  }
  return found;
}

/** Merges overlapping or touching intervals into sorted disjoint ones. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function redactOnce(text: string, secrets: readonly string[]): string {
  const intervals = secrets.flatMap((secret) => findOccurrences(text, secret));
  if (intervals.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const [start, end] of mergeIntervals(intervals)) {
    out += text.slice(cursor, start) + REDACTED;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Replaces every case-sensitive occurrence of each non-empty secret with `[redacted]`. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const usable = secrets.filter((secret) => secret !== '');
  if (usable.length === 0) return text;
  let current = text;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = redactOnce(current, usable);
    if (next === current) break;
    current = next;
  }
  return current;
}

function maskRun(run: string): string {
  let digitsLeft = run.replace(/\D/g, '').length;
  let out = '';
  for (const ch of run) {
    if (ch >= '0' && ch <= '9') {
      out += digitsLeft > KEEP_LAST_DIGITS ? '*' : ch;
      digitsLeft -= 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Masks runs of 7+ digits (with optional `+`, spaces, hyphens), keeping the last 3 digits. */
export function maskPhoneNumbers(text: string): string {
  return text.replace(PHONE_RUN, maskRun);
}
