// Crypt_Dashboard page (Requirement 15). Static server component: same output
// with or without GEMINI_API_KEY (15.8), no API request (15.7).
import type { Metadata } from 'next';
import { Dashboard } from '../../dashboard/Dashboard';
import { Header } from '../../ui/Header';

export const metadata: Metadata = {
  title: 'The Crypt · Lazarus',
  description: 'How the Lazarus SMS gateway works.',
};

export default function CryptPage() {
  return (
    <>
      <Header current="crypt" />
      <Dashboard />
    </>
  );
}
