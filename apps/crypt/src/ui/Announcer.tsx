'use client';
// Visually hidden live regions (Requirements 16.4, 16.9, 16.11, 19.11).
// Each new bubble id is announced once: urgent notes in the assertive region,
// everything else in the polite region. Mode and Replies_Left texts are
// announced only when they change, never on first render.
import { useEffect, useRef, useState } from 'react';
import type { Bubble } from '../session/session.types';
import { announcementFor } from './Bubble';

/** Live-region messages kept in the DOM; older ones were already read. */
const KEEP = 10;

interface Message {
  readonly key: number;
  readonly text: string;
}

export interface AnnouncerProps {
  readonly bubbles: readonly Bubble[];
  /** Current T9 mode text (`abc`, `ABC`, `123`), or null in Keyboard_Input. */
  readonly mode: string | null;
  /** Replies_Left_Indicator text, followed by the hint when it is shown. */
  readonly repliesText: string;
}

function maxId(bubbles: readonly Bubble[]): number {
  return bubbles.reduce((m, b) => Math.max(m, b.id), 0);
}

function useChange<T>(value: T, onChange: (v: T) => void): void {
  const prev = useRef(value);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    onChange(value);
  }, [value, onChange]);
}

export function Announcer({ bubbles, mode, repliesText }: AnnouncerProps) {
  const [polite, setPolite] = useState<readonly Message[]>([]);
  const [assertive, setAssertive] = useState<readonly Message[]>([]);
  const lastAnnounced = useRef(maxId(bubbles));
  const nextKey = useRef(0);

  const [push] = useState(() => (region: 'polite' | 'assertive', text: string) => {
    const msg: Message = { key: nextKey.current++, text };
    const set = region === 'polite' ? setPolite : setAssertive;
    set((list) => [...list, msg].slice(-KEEP));
  });

  useEffect(() => {
    for (const b of bubbles) {
      if (b.id <= lastAnnounced.current) continue;
      lastAnnounced.current = b.id;
      const text = announcementFor(b);
      if (text !== null) push(b.urgent === true ? 'assertive' : 'polite', text);
    }
  }, [bubbles, push]);

  const [onMode] = useState(() => (m: string | null) => {
    if (m !== null) push('polite', m);
  });
  const [onReplies] = useState(() => (t: string) => {
    push('polite', t);
  });
  useChange(mode, onMode);
  useChange(repliesText, onReplies);

  return (
    <>
      <div className="visually-hidden" aria-live="polite" data-testid="announcer-polite">
        {polite.map((m) => (
          <p key={m.key}>{m.text}</p>
        ))}
      </div>
      <div className="visually-hidden" aria-live="assertive" data-testid="announcer-assertive">
        {assertive.map((m) => (
          <p key={m.key}>{m.text}</p>
        ))}
      </div>
    </>
  );
}
