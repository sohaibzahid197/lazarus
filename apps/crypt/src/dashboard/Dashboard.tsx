// Crypt_Dashboard (Requirement 15). A server component rendered only from the
// constants of dashboard.data.ts: no form, no input and no fetch (15.7, 15.8).
// Senders appear only as the Masked_Number computed in the data module (15.5).
import {
  COMMANDS,
  DEMO_COUNTERS,
  DEMO_DATA_LABEL,
  EXPLANATION,
  HEARTBEAT_LEGEND,
  SAMPLE_CONVERSATION,
  type SampleMessage,
} from './dashboard.data';
import { Heartbeat } from '../ui/Heartbeat';
import { hasUrdu, textDirection } from '../ui/direction';

const COUNTER_ORDER = ['received', 'repliesSent', 'partsSent', 'ignored'] as const;

function SampleBubble({ message }: { readonly message: SampleMessage }) {
  const urdu = hasUrdu(message.text);
  const who = message.direction === 'incoming' ? `Incoming from ${message.from ?? ''}` : 'Outgoing from Lazarus';
  return (
    <li className={`dashboard__message dashboard__message--${message.direction}`}>
      <p className="dashboard__message-meta">{who}</p>
      <p
        className="dashboard__message-text"
        dir={textDirection(message.text)}
        lang={urdu ? 'ur' : undefined}
      >
        {message.text}
      </p>
    </li>
  );
}

export function Dashboard() {
  return (
    <main className="dashboard">
      <h1 className="dashboard__title">The Crypt</h1>

      <section className="dashboard__section" aria-labelledby="dashboard-how">
        <h2 id="dashboard-how">How the gateway works</h2>
        {EXPLANATION.map((line) => (
          <p key={line} className="dashboard__text">
            {line}
          </p>
        ))}
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-commands">
        <h2 id="dashboard-commands">Commands</h2>
        <dl className="dashboard__commands">
          {COMMANDS.map((c) => (
            <div key={c.command} className="dashboard__command">
              <dt className="dashboard__command-name">
                <code>{c.command}</code>
              </dt>
              <dd className="dashboard__command-text">{c.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-counters">
        <h2 id="dashboard-counters">Today on the gateway</h2>
        <p className="dashboard__demo-label">{DEMO_DATA_LABEL}</p>
        <dl className="dashboard__counters">
          {COUNTER_ORDER.map((key) => {
            const counter = DEMO_COUNTERS[key];
            return (
              <div key={key} className="dashboard__counter">
                <dt className="dashboard__counter-name">{counter.name}</dt>
                <dd className="dashboard__counter-value">{counter.value}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-sample">
        <h2 id="dashboard-sample">Sample conversation</h2>
        <p className="dashboard__text dashboard__text--muted">
          Phone numbers are masked. Only the last 3 digits are shown.
        </p>
        <ol className="dashboard__conversation">
          {SAMPLE_CONVERSATION.map((message, i) => (
            <SampleBubble key={i} message={message} />
          ))}
        </ol>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-legend">
        <h2 id="dashboard-legend">What the heartbeat means</h2>
        <ul className="dashboard__legend">
          {HEARTBEAT_LEGEND.map((item) => (
            <li
              key={item.state}
              className={`dashboard__legend-item dashboard__legend-item--${item.state.toLowerCase()}`}
            >
              <Heartbeat state={item.state} mode="static" />
              <p className="dashboard__legend-look">{item.look}</p>
              <p className="dashboard__legend-meaning">{item.meaning}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
