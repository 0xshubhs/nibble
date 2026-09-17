import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="wrap wrap-narrow section" style={{ textAlign: 'center' }}>
      <div className="stack" style={{ alignItems: 'center', gap: 22 }}>
        <Logo size={64} id="notfound-mark" />
        <p className="eyebrow">404</p>
        <h1>
          Something took a <span className="hl hl-block">bite</span> out of this page.
        </h1>
        <p className="lede" style={{ marginInline: 'auto' }}>
          The link is wrong, or the page moved. The documentation index has everything that
          does exist.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" href="/docs/">
            Read the docs
          </Link>
          <Link className="btn btn-outline" href="/">
            Back to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
