// Persistent STOP banner (Requirement 12.5). Rendered from the latest
// Session_Snapshot, so it appears and disappears in the same render in which
// the snapshot is replaced or a new session starts.
import { STOP_BANNER_TEXT } from './texts';

export interface StopBannerProps {
  /** STOP status of the latest Session_Snapshot. */
  readonly stopped: boolean;
}

export function StopBanner({ stopped }: StopBannerProps) {
  if (!stopped) return null;
  return <p className="stop-banner">{STOP_BANNER_TEXT}</p>;
}
