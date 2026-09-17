import Link from 'next/link';
import { REPO, RELEASES, VERSION } from '@/lib/site';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div className="footer-col">
          <h4>Nibble</h4>
          <span className="footer-note">
            An on-device memory your LLM can search, plus reminders that actually reach you.
          </span>
          <span className="footer-note">
            v{VERSION} · MIT licensed · no trackers on this page
          </span>
        </div>

        <div className="footer-col">
          <h4>Docs</h4>
          <Link href="/docs/">Overview</Link>
          <Link href="/docs/how-it-works/">How it works</Link>
          <Link href="/docs/connector/">MCP connector</Link>
          <Link href="/docs/privacy/">What leaves the device</Link>
        </div>

        <div className="footer-col">
          <h4>Get it</h4>
          <Link href="/download/">Download</Link>
          <a href={RELEASES}>Releases</a>
          <a href={`${REPO}/blob/main/LICENSE`}>MIT License</a>
        </div>

        <div className="footer-col">
          <h4>Project</h4>
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/issues`}>Report a bug</a>
          <Link href="/docs/build/">Build it yourself</Link>
        </div>
      </div>
    </footer>
  );
}
