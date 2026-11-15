import type { Metadata } from 'next';
import { Cinzel } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// The one display font for headings, self-hosted by next/font at build time,
// so pages make no third-party font request (design section 8). Each page
// renders the shared Header itself, because it marks the current page.
const display = Cinzel({ subsets: ['latin'], weight: ['700'], display: 'swap', variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Lazarus',
  description: 'Text a question, get a short answer by SMS.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
