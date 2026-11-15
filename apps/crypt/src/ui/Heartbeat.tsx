// Heartbeat line and visible state label (Requirements 14.2–14.9, 15.6, 16.3).
// No 'use client' and no hooks, so the server-rendered Crypt_Dashboard legend
// can reuse it in static mode. Colors, the ember glow, the 600 ms pulse and the
// reduced-motion rules live in globals.css (design section 8); this component
// only sets class names and `data-state`, and the SVG strokes `currentColor`.
import { STATE_LABELS, type PhoneStateName } from './texts';

export interface HeartbeatProps {
  /** Phone_Mock state, from `phoneState()` of the session reducer. */
  readonly state: PhoneStateName;
  /**
   * Changes once per added reply or Reminder part. Each new value remounts the
   * line, which restarts the CSS pulse (14.7). 0 means no pulse yet.
   */
  readonly pulseKey?: number;
  /** `static` draws the line with no pulse, for the dashboard legend (15.6). */
  readonly mode?: 'live' | 'static';
}

// A heartbeat trace for ALIVE, SENDING and ERROR, and a flat line for SLEEPING (14.6).
// Width 99 keeps the viewBox at 6 digits, so no attribute has a 7-digit run (15.10).
const BEAT_PATH = 'M0 12 H34 L40 4 L46 20 L52 12 H60 L64 8 L68 12 H99';
const FLAT_PATH = 'M0 12 H99';

export function Heartbeat({ state, pulseKey = 0, mode = 'live' }: HeartbeatProps) {
  const pulsing = mode === 'live' && state !== 'SLEEPING' && pulseKey > 0;
  const lineClass = pulsing ? 'heartbeat__line heartbeat__line--pulse' : 'heartbeat__line';
  return (
    <div className={`heartbeat heartbeat--${state.toLowerCase()}`} data-state={state}>
      {/* Decorative: the visible label below carries the meaning (16.3). */}
      <svg
        className="heartbeat__svg"
        viewBox="0 0 99 24"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          key={pulsing ? pulseKey : 'still'}
          className={lineClass}
          d={state === 'SLEEPING' ? FLAT_PATH : BEAT_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="heartbeat__label">{STATE_LABELS[state]}</span>
    </div>
  );
}
