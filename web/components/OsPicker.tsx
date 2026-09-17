'use client';

import { useEffect, useState } from 'react';
import { LATEST } from '@/lib/site';

type Os = 'macOS' | 'Windows' | 'Linux' | null;

const FILE: Record<string, string> = {
  macOS: 'the .dmg',
  Windows: 'the portable .exe',
  Linux: 'the .AppImage',
};

/**
 * Names the visitor's platform in the main button. It renders the neutral
 * label first and refines it after mount, so the exported HTML is correct for
 * everyone and nothing depends on JavaScript to be usable.
 */
export function OsPicker() {
  const [os, setOs] = useState<Os>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/i.test(ua) ? 'macOS' : /Win/i.test(ua) ? 'Windows' : /Linux|X11|Android/i.test(ua) ? 'Linux' : null);
  }, []);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <a className="btn btn-primary" href={LATEST}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
          </svg>
          {os ? `Download for ${os}` : 'Download'}
        </a>
        <a className="btn btn-outline" href={LATEST}>
          All builds and checksums
        </a>
      </div>
      <p className="small muted">
        {os ? `Take ${FILE[os]} from the release page.` : 'Pick the file for your platform on the release page.'}
      </p>
    </div>
  );
}
