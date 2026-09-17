'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { LATEST } from '@/lib/site';

const LINKS = [
  { href: '/docs/', label: 'Docs' },
  { href: '/docs/how-it-works/', label: 'How it works', optional: true },
  { href: '/docs/connector/', label: 'Connect', optional: true },
  { href: '/faq/', label: 'FAQ' },
  { href: '/download/', label: 'Download' },
];

export function Nav() {
  const pathname = usePathname();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav${stuck ? ' is-stuck' : ''}`}>
      <div className="wrap nav-in">
        <Link className="logo" href="/">
          <Logo id="nav-mark" />
          Nibble
        </Link>

        <nav className="nav-links">
          {LINKS.map((l) => {
            // /docs/ is the prefix of every docs page, so it only lights up on
            // an exact match; the deeper links own their own subtree.
            const active =
              l.href === '/docs/' ? pathname === '/docs' || pathname === '/docs/' : pathname?.startsWith(l.href.replace(/\/$/, ''));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? 'is-active' : undefined}
                data-optional={l.optional ? '' : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <a className="btn btn-primary btn-sm nav-cta" href={LATEST}>
          Get it
        </a>
      </div>
    </header>
  );
}
