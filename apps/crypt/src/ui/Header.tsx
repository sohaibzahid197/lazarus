// Shared header of both pages (Requirement 15.9). A server component: one link
// to the Ouija_Simulator and one to the Crypt_Dashboard, with
// `aria-current="page"` on the link of the current page.
import Link from 'next/link';

export type HeaderPage = 'simulator' | 'crypt';

export interface HeaderProps {
  readonly current: HeaderPage;
}

const LINKS: readonly { readonly page: HeaderPage; readonly href: string; readonly text: string }[] = [
  { page: 'simulator', href: '/', text: 'Ouija simulator' },
  { page: 'crypt', href: '/crypt', text: 'The Crypt' },
];

export function Header({ current }: HeaderProps) {
  return (
    <header className="site-header">
      <p className="site-header__title">Lazarus</p>
      <nav aria-label="Main">
        <ul className="site-header__links">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="site-header__link"
                aria-current={link.page === current ? 'page' : undefined}
              >
                {link.text}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
