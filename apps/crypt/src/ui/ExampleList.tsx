'use client';

// Example message list (Requirements 2.2, 2.3, 16.7). Activating an example
// only fills the Compose_Field through `setCompose`; it sends nothing. The
// parent discards any Pending_Character in the same handler.
import { hasUrdu, textDirection } from './direction';
import { EXAMPLE_MESSAGES } from './examples';

export interface ExamplesProps {
  readonly setCompose: (text: string) => void;
}

export function Examples({ setCompose }: ExamplesProps) {
  return (
    <section className="examples" aria-labelledby="examples-heading">
      <h2 id="examples-heading" className="examples__heading">
        Try an example
      </h2>
      <ul className="examples__list">
        {EXAMPLE_MESSAGES.map((text) => (
          <li key={text} className="examples__item">
            <button
              type="button"
              className="examples__button"
              lang={hasUrdu(text) ? 'ur' : undefined}
              dir={textDirection(text)}
              onClick={() => {
                setCompose(text);
              }}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
