import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Capture sources',
  description: 'Clipboard, folders, the hotkey, and the two sources that are not built yet.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the memory"
        title="Capture sources"
        lede="Nothing is captured until you turn a source on, and every source says exactly what it is doing."
      />

      <Table
        head={['Source', 'Status', 'What it does']}
        rows={[
          [
            <strong key="c">Clipboard</strong>,
            <span className="pill pill-solid" key="cs">live</span>,
            'Remembers text you copy. Drops anything matching a credential shape or a high-entropy blob before storing it.',
          ],
          [
            <strong key="f">Folders</strong>,
            <span className="pill pill-solid" key="fs">live</span>,
            'Reads text and Markdown from folders you choose, and notices when they change.',
          ],
          [
            <strong key="q">Quick capture</strong>,
            <span className="pill pill-solid" key="qs">live</span>,
            'A global hotkey that stores the clipboard once, deliberately, with nothing watching in between.',
          ],
          [
            <strong key="a">Meetings &amp; audio</strong>,
            <span className="pill pill-quiet" key="as">phase 2</span>,
            'Permission handling is real; capture is not wired up yet.',
          ],
          [
            <strong key="s">Screen</strong>,
            <span className="pill pill-quiet" key="ss">phase 3</span>,
            'The same. The most invasive source, so it ships last and with the strictest treatment.',
          ],
        ]}
      />

      <p>
        The two unbuilt sources still appear in the list and still report their real permission
        state. They say they are not capturing, rather than being hidden in a way that leaves
        you guessing, or shown in a way that implies they are recording.
      </p>

      <h2 id="clipboard">Clipboard</h2>
      <p>
        No platform offers a clipboard-change event, so this polls every 2.5 seconds: long
        enough to be invisible on a battery, short enough that two quick copies are both seen.
        When you turn it on it seeds itself with whatever is already on the clipboard, so
        starting the source does not immediately hoover up something unrelated from an hour
        ago.
      </p>
      <p>
        Text under 24 characters is ignored as noise, and anything over 200,000 characters is
        skipped rather than chunked into hundreds of rows.
      </p>

      <h3 id="secrets">What it refuses to store</h3>
      <p>Before anything is written, the text is checked against the shapes of things you would be upset to find in a searchable log:</p>
      <ul>
        <li>PEM private key blocks</li>
        <li>OpenAI-style <code>sk-</code> keys, GitHub <code>ghp_</code> tokens, Slack <code>xox</code> tokens</li>
        <li>AWS access key ids, Google API keys, JWTs</li>
        <li>Card-shaped runs of 13 to 16 digits</li>
        <li>A line that says password, secret, token or api key followed by a colon or equals</li>
        <li>Any short unbroken string with high enough entropy to be a random credential</li>
      </ul>
      <Callout tone="warn" title="A net, not a guarantee">
        The filter is deliberately biased towards throwing away something harmless over storing
        a secret, and it will still miss things. That is why Forget is on every result and on
        every source, and why the store is a plain file you can read.
      </Callout>

      <h2 id="folders">Folders</h2>
      <p>
        Point it at a notes directory, a project, a wiki export. It reads text and Markdown
        files, skips anything over 2 MB, skips anything with a null byte in it, and re-reads a
        file when it changes. Node modules and dot directories are not walked.
      </p>

      <h2 id="hotkey">Quick capture</h2>
      <p>
        The deliberate counterpart to the clipboard source: one global hotkey stores the
        clipboard once, and nothing is watched in between. See{' '}
        <Link href="/docs/quick-capture/">Quick capture</Link>.
      </p>

      <h2 id="pause">Pause, and forget</h2>
      <p>
        There is one global <strong>pause</strong>. Sources keep running but nothing is stored,
        which is a different thing from stopping them: nothing has to be re-permissioned or
        re-seeded when you come back. The hotkey respects the pause too, and says so instead of
        making an exception for itself.
      </p>
      <p>
        <strong>Forget</strong> exists on every individual result and on every source. Forget a
        source and every chunk it ever captured is tombstoned; Compact rewrites both files
        without them.
      </p>

      <h2 id="dedupe">Deduplication</h2>
      <p>
        Each capture is hashed with its source. The same content from the same source inside
        six hours is dropped. Copying the same paragraph four times while you edit it produces
        one memory, not four.
      </p>

      <DocFooter href="/docs/capture/" />
    </>
  );
}
