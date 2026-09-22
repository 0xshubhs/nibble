import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ORIGIN } from '@/lib/site';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import './globals.css';

/**
 * Satoshi is the ENS typeface. It is bundled with the site rather than
 * fetched from a font CDN: one 42 KB variable file covers 300 to 900, and it
 * means the page makes no third-party request at all, which is awkward to
 * claim while loading someone else's stylesheet to say it.
 */
const satoshi = localFont({
  src: './fonts/Satoshi-Variable.woff2',
  variable: '--font-satoshi',
  weight: '300 900',
  display: 'swap',
});

const description =
  'Nibble keeps a local memory of what you capture, indexes it on your own machine, ' +
  'and hands it to Claude, ChatGPT or any MCP client as a tool they can search. ' +
  'No account, no server, nothing uploaded.';

export const metadata: Metadata = {
  // Without this, Open Graph and canonical URLs stay relative and most
  // scrapers drop them.
  metadataBase: new URL(ORIGIN),
  alternates: { canonical: '/' },
  title: {
    default: 'Nibble — an on-device memory your LLM can search',
    template: '%s — Nibble',
  },
  description,
  applicationName: 'Nibble',
  keywords: [
    'MCP',
    'local memory',
    'semantic search',
    'Electron',
    'Claude',
    'on-device embeddings',
    'reminders',
  ],
  openGraph: {
    title: 'Nibble — an on-device memory your LLM can search',
    description,
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

/**
 * Runs before paint so a stored theme choice applies immediately instead of
 * flashing the OS-preferred theme first. Inline and tiny on purpose: this is
 * the one script on the page allowed to block render.
 */
const themeScript = `
try {
  var t = localStorage.getItem('nibble-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={satoshi.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
