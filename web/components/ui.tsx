import Link from 'next/link';
import { docNeighbours } from '@/lib/site';

/** A block of code with an optional label above it. Never syntax-coloured:
 *  every snippet here is a shell line or a small file, and a highlighter
 *  would be more machinery than the content is worth. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div>
      {label ? <span className="code-label">{label}</span> : null}
      <code className="code">{children}</code>
    </div>
  );
}

export function Callout({
  children,
  tone = 'info',
  title,
}: {
  children: React.ReactNode;
  tone?: 'info' | 'warn' | 'quiet';
  title?: string;
}) {
  const cls = tone === 'warn' ? 'callout callout-warn' : tone === 'quiet' ? 'callout callout-quiet' : 'callout';
  return (
    <aside className={cls}>
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </aside>
  );
}

/** The header every documentation page starts with. */
export function DocHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <header className="doc-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  );
}

/** Previous and next, derived from the one list in lib/site.ts. */
export function DocFooter({ href }: { href: string }) {
  const { prev, next } = docNeighbours(href);
  return (
    <nav className="doc-next">
      {prev ? <Link href={prev.href}>&larr; {prev.title}</Link> : <span />}
      {next ? <Link href={next.href}>{next.title} &rarr;</Link> : <span />}
    </nav>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
