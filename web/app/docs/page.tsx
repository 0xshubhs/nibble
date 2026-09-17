import type { Metadata } from 'next';
import Link from 'next/link';
import { DocHead, Callout } from '@/components/ui';
import { DOCS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Overview',
  description: 'What Nibble is, what it is not, and how the parts fit together.',
};

export default function DocsIndex() {
  return (
    <>
      <DocHead
        eyebrow="documentation"
        title="Overview"
        lede="Nibble is a background app that keeps a searchable memory of what you capture, on your own machine, and lends it to any LLM over MCP."
      />

      <h2 id="what-it-is">What it is</h2>
      <p>
        Three things share one process, because they are the same idea from different angles:
        something that remembers for you, something that can find what it remembered, and
        something that taps you on the shoulder at the right time.
      </p>
      <ul>
        <li>
          <strong>A memory.</strong> Text you copy, files you keep, notes you write. It is
          chunked, indexed and embedded locally, then searched by keyword and by meaning at
          once.
        </li>
        <li>
          <strong>A connector.</strong> An MCP server on loopback, so Claude, ChatGPT or any
          other client can search that memory as a tool instead of asking you to paste context
          again.
        </li>
        <li>
          <strong>Reminders.</strong> Real system notifications, with repeats that survive
          sleep and daylight saving.
        </li>
      </ul>

      <h2 id="what-it-is-not">What it is not</h2>
      <p>
        It is not a note-taking app, and it does not try to be your second brain in the sense
        of a place you go and write. Nothing here has a folder tree, a tag system or a daily
        note. The bet is the opposite one: that you already produce enough material by
        working, and what is missing is the ability to ask about it later.
      </p>
      <p>
        It is also not a sync service. There is no account, no server and no copy of your
        memory anywhere but your disk. That is a real limitation as well as the point: two
        machines are two memories.
      </p>

      <Callout title="Nothing leaves the device by default">
        The embedding model is downloaded once and then runs offline. The connector binds to
        127.0.0.1. The only way text reaches a third party is if you switch the embedder to a
        cloud provider yourself, which is off by default and{' '}
        <Link href="/docs/privacy/">documented in full</Link>.
      </Callout>

      <h2 id="the-shape">The shape of it</h2>
      <p>
        One Electron codebase in TypeScript, compiled by plain <code>tsc</code> with no
        bundler, producing a <code>.dmg</code>, a portable <code>.exe</code> and an{' '}
        <code>.AppImage</code>. The memory is two flat files rather than a database, so the
        same code behaves identically on all three platforms with no native module to compile
        per architecture.
      </p>

      <h2 id="where-to-start">Where to go next</h2>
      {DOCS.map((group) => (
        <div key={group.title}>
          <h3>{group.title}</h3>
          <ul>
            {group.pages
              .filter((p) => p.href !== '/docs/')
              .map((p) => (
                <li key={p.href}>
                  <Link href={p.href}>{p.title}</Link> — {p.blurb}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}
