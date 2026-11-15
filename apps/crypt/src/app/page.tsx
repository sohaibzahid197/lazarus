// Ouija_Simulator page (Requirement 2). A server component that renders the
// shared header and the client-side simulator.
import { Header } from '../ui/Header';
import { OuijaSimulator } from '../ui/OuijaSimulator';

export default function HomePage() {
  return (
    <>
      <Header current="simulator" />
      <OuijaSimulator />
    </>
  );
}
