// Replies_Left_Indicator and its 0-hint (Requirements 19.7, 19.9). Both numbers
// come from the session and from DEFAULT_SETTINGS; the Crypt_App defines no
// limit of its own (19.6). Announcements go through Announcer (19.11), so this
// component has no live region.
import { DEFAULT_SETTINGS } from '@lazarus/brain';
import { NO_REPLIES_LEFT_HINT, repliesLeftText } from './texts';

export interface RepliesLeftProps {
  /** Latest Replies_Left of the session, 0 to DEFAULT_SETTINGS.perNumberLimit. */
  readonly repliesLeft: number;
}

export function RepliesLeft({ repliesLeft }: RepliesLeftProps) {
  return (
    <div className="replies-left">
      <p className="replies-left__count">
        {repliesLeftText(repliesLeft, DEFAULT_SETTINGS.perNumberLimit)}
      </p>
      {repliesLeft === 0 ? <p className="replies-left__hint">{NO_REPLIES_LEFT_HINT}</p> : null}
    </div>
  );
}
