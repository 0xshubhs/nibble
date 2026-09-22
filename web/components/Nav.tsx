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
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // Reflects whatever the no-flash script in layout.tsx already put on
    // <html>, so the button's icon matches the page on first paint.
    const stored = document.documentElement.getAttribute('data-theme');
    setTheme(stored === 'dark' ? 'dark' : stored === 'light' ? 'light' : null);
  }, []);

  const toggleTheme = () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = theme ?? (prefersDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem('nibble-theme', next);
    } catch {
      /* private mode or storage disabled: the toggle still works for this load */
    }
    setTheme(next);
  };

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

        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle dark and light theme"
        >
          <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
          </svg>
          <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5Z" />
          </svg>
        </button>

        <a className="btn btn-primary btn-sm nav-cta" href={LATEST}>
          Get it
        </a>
      </div>
    </header>
  );
}
