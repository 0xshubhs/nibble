/** Everything the pages agree on: links, version, and the shape of the docs. */

export const REPO = 'https://github.com/0xshubhs/nibble';
export const RELEASES = `${REPO}/releases`;
export const LATEST = `${REPO}/releases/latest`;
export const VERSION = '0.1.0';

export interface DocPage {
  href: string;
  title: string;
  blurb: string;
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

/**
 * The sidebar, the docs index and the prev/next links are all generated from
 * this one list, so a page cannot be added to the site and left unreachable.
 */
export const DOCS: DocGroup[] = [
  {
    title: 'Start here',
    pages: [
      {
        href: '/docs/',
        title: 'Overview',
        blurb: 'What Nibble is, what it is not, and the shape of the whole thing.',
      },
      {
        href: '/docs/install/',
        title: 'Install',
        blurb: 'Every build, what it writes, and the first-launch warnings on each OS.',
      },
      {
        href: '/docs/how-it-works/',
        title: 'How it works',
        blurb: 'Capture, chunk, embed, search: the path a piece of text takes.',
      },
    ],
  },
  {
    title: 'The memory',
    pages: [
      {
        href: '/docs/capture/',
        title: 'Capture sources',
        blurb: 'Clipboard, folders, the hotkey, and the two that are not built yet.',
      },
      {
        href: '/docs/search/',
        title: 'Search and recall',
        blurb: 'BM25, cosine, rank fusion, and why "no results" is an answer.',
      },
      {
        href: '/docs/embeddings/',
        title: 'Embeddings',
        blurb: 'The on-device model, the optional cloud backends, and what changes.',
      },
      {
        href: '/docs/storage/',
        title: 'Storage and portability',
        blurb: 'Two flat files, tombstones, compaction, and portable mode.',
      },
    ],
  },
  {
    title: 'Connect an LLM',
    pages: [
      {
        href: '/docs/connector/',
        title: 'MCP connector',
        blurb: 'Turn it on, connect a client, and the three things keeping it shut.',
      },
      {
        href: '/docs/tools/',
        title: 'Tool reference',
        blurb: 'The seven tools your assistant gets, with arguments and output.',
      },
    ],
  },
  {
    title: 'The rest of the app',
    pages: [
      {
        href: '/docs/reminders/',
        title: 'Reminders',
        blurb: 'Repeats, snooze, sleep, daylight saving, and real notifications.',
      },
      {
        href: '/docs/quick-capture/',
        title: 'Quick capture',
        blurb: 'One global hotkey that remembers the clipboard on purpose.',
      },
      {
        href: '/docs/notch/',
        title: 'Notch panel',
        blurb: 'The macOS panel that hangs off the notch, and why it is a guess.',
      },
    ],
  },
  {
    title: 'Under the hood',
    pages: [
      {
        href: '/docs/privacy/',
        title: 'What leaves the device',
        blurb: 'Every network call the app can make, and what turns each one on.',
      },
      {
        href: '/docs/architecture/',
        title: 'Architecture',
        blurb: 'Processes, the preload bridge, and where each file lives.',
      },
      {
        href: '/docs/build/',
        title: 'Build and release',
        blurb: 'Running from source, the three native builds, and signing.',
      },
    ],
  },
];

export const DOC_PAGES: DocPage[] = DOCS.flatMap((g) => g.pages);

export function docNeighbours(href: string): { prev: DocPage | null; next: DocPage | null } {
  const i = DOC_PAGES.findIndex((p) => p.href === href);
  if (i === -1) return { prev: null, next: null };
  return { prev: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}
