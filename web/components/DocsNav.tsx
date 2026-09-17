'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS } from '@/lib/site';

/** The sidebar. Active state is the only reason this is a client component. */
export function DocsNav() {
  const pathname = usePathname();
  const here = pathname?.endsWith('/') ? pathname : `${pathname}/`;

  return (
    <aside className="docs-nav">
      {DOCS.map((group) => (
        <div className="docs-group" key={group.title}>
          <h4>{group.title}</h4>
          {group.pages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className={here === page.href ? 'is-active' : undefined}
            >
              {page.title}
            </Link>
          ))}
        </div>
      ))}
    </aside>
  );
}
