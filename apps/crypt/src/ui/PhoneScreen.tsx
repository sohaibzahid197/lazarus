'use client';
// The conversation thread of the Phone_Mock (Requirements 2.4, 2.5, 16.6).
// No live region here: announcements go through Announcer, so a re-render or
// a Session_Reset never re-announces old bubbles.
import { useEffect, useRef, type ReactNode } from 'react';
import type { Bubble as BubbleData } from '../session/session.types';
import { Bubble } from './Bubble';

export interface PhoneScreenProps {
  readonly bubbles: readonly BubbleData[];
  /** Slot for the STOP banner (Requirement 12.5). */
  readonly banner?: ReactNode;
  /** Slot for content above the thread, such as the T9 mode indicator. */
  readonly header?: ReactNode;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function PhoneScreen({ bubbles, banner, header }: PhoneScreenProps) {
  const lastRef = useRef<HTMLLIElement>(null);
  const lastId = bubbles.at(-1)?.id;

  useEffect(() => {
    const el = lastRef.current;
    if (lastId === undefined || el === null || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [lastId]);

  return (
    <div className="phone-screen">
      {header}
      {banner}
      {/* Focusable so keyboard users can scroll a long thread (WCAG 2.1.1). */}
      <ol className="phone-screen__thread" aria-label="Messages" tabIndex={0}>
        {bubbles.map((b) => (
          <li
            key={b.id}
            ref={b.id === lastId ? lastRef : undefined}
            className={`phone-screen__item phone-screen__item--${b.kind === 'outgoing' ? 'out' : 'in'}`}
          >
            <Bubble bubble={b} />
          </li>
        ))}
      </ol>
    </div>
  );
}
