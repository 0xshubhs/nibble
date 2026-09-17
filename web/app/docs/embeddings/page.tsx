import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Embeddings',
  description: 'The on-device model, the optional cloud backends, and what switching changes.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the memory"
        title="Embeddings"
        lede="A small model on your machine by default, with two cloud options for people who want the recall and accept the trade."
      />

      <Table
        head={['Backend', 'Model', 'Width', 'Notes']}
        rows={[
          [
            <strong key="l">local (default)</strong>,
            <code key="lm">Xenova/all-MiniLM-L6-v2</code>,
            '384',
            'About 23 MB, downloaded once, then fully offline',
          ],
          [
            <strong key="g">cloud</strong>,
            <code key="gm">gemini-embedding-001</code>,
            '768',
            'Needs a Google API key. Your text is sent to Google',
          ],
          [
            <strong key="v">cloud</strong>,
            <code key="vm">voyage-3.5-lite</code>,
            '1024',
            'Needs a Voyage key. Your text is sent to Voyage',
          ],
        ]}
      />

      <h2 id="local">The local model</h2>
      <p>
        A quantised MiniLM, run through Transformers.js in an Electron{' '}
        <strong>utility process</strong>. It is downloaded on first use and cached in the data
        folder, which means a portable install carries its own model on the stick with it.
      </p>
      <p>
        The separate process is not architectural decoration. Embedding a batch is tens of
        milliseconds of CPU; in the main process that would stall the tray, the window and the
        reminder timers on every capture.
      </p>

      <h2 id="download">While it is downloading</h2>
      <p>
        Capture keeps working and search falls back to keywords. The Memory tab shows the
        percentage and how many chunks are waiting, and the moment the model is ready the
        backlog drains sixteen chunks at a time, with a pause between batches so the rest of
        the app keeps its turn.
      </p>

      <h2 id="switching">Switching backends</h2>
      <Callout tone="warn" title="Switching invalidates every stored vector">
        Vectors from different models are not comparable, even at the same width. Changing the
        backend drops <code>vectors.bin</code> and re-embeds in the background. Your captured
        text is untouched, and keyword search keeps working throughout.
      </Callout>
      <p>
        The store records which model produced its vectors. If that model id changes for any
        reason, including an upgrade, the vectors are invalidated rather than silently
        reinterpreted as if they meant the same thing.
      </p>

      <h2 id="cloud">What the cloud backends cost you</h2>
      <p>
        Better recall, and the whole premise. With a cloud backend selected, the text of
        everything you capture is sent to that provider to be embedded. Queries are sent too.
        This is off by default and it is the only case in which your captured text leaves the
        machine; <Link href="/docs/privacy/">What leaves the device</Link> lists every network
        call the app can make.
      </p>

      <DocFooter href="/docs/embeddings/" />
    </>
  );
}
