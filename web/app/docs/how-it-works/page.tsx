import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'The path a piece of text takes: capture, chunk, store, embed, search.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="start here"
        title="How it works"
        lede="Follow one paragraph from the moment you copy it to the moment your assistant quotes it back."
      />

      <h2 id="capture">1. Capture</h2>
      <p>
        A source hands the memory a piece of text with a label: which source it came from, an
        optional title, and when it happened. The clipboard source polls every 2.5 seconds
        because no platform offers a clipboard-change event; the folder source watches the
        directories you nominated; the hotkey fires once, when you press it.
      </p>
      <p>
        Before anything is stored, the text is hashed with its source. The same content from
        the same source inside six hours is dropped, so an ambient source cannot fill the
        store with copies of itself.
      </p>

      <h2 id="chunk">2. Chunk</h2>
      <p>
        Long text is split into overlapping pieces of about 900 characters, never more than
        1400, with 160 characters of overlap. The split prefers a paragraph break, then a
        sentence end, then any space.
      </p>
      <p>
        This is not tidiness. The local model truncates at 256 word-pieces, so a long document
        embedded whole loses everything past the cutoff, and a sentence that straddles a
        boundary has to stay findable from either side.
      </p>

      <h2 id="store">3. Store, immediately</h2>
      <p>
        Each chunk is appended to <code>chunks.jsonl</code> and given a zeroed row in{' '}
        <code>vectors.bin</code>. It is keyword-searchable from that instant. The vector slot
        is filled in later.
      </p>
      <Callout title="Why the two are decoupled">
        If capture waited for the embedder, a model that is still downloading would mean
        nothing gets stored, and an app killed mid-batch would lose whatever was in flight.
        Writing first and embedding behind it turns both of those from data loss into a
        temporary drop in search quality.
      </Callout>

      <h2 id="embed">4. Embed, behind it</h2>
      <p>
        A background pass takes the oldest unembedded rows, sixteen at a time, and asks the
        embedder for vectors. The model runs in its own utility process: embedding a batch is
        tens of milliseconds of CPU, which in the main process would stall the tray, the
        window and the reminder timers.
      </p>
      <p>
        Whether a row is embedded is not stored anywhere. It is derived from the vector file
        at load: a reserved slot is all zeros, and a real embedding is normalised to unit
        length, so it can never be. The log and the vectors cannot drift apart, whenever the
        app was killed.
      </p>

      <h2 id="search">5. Search</h2>
      <p>
        A query is embedded and run two ways at once: BM25 over the inverted index, and cosine
        similarity over the vectors. The two ranked lists are fused by Reciprocal Rank Fusion,
        which combines positions rather than scores, so BM25 numbers and cosines never have to
        be put on a common scale.
      </p>
      <p>
        Each result says how it was found: <strong>words</strong>, <strong>meaning</strong>, or
        both. <Link href="/docs/search/">Search and recall</Link> explains the floor, the
        fusion constant, and why no results is an answer worth being able to give.
      </p>

      <h2 id="ask">6. Ask</h2>
      <p>
        With the connector on, all of that is a tool call away for whatever client you have
        connected.
      </p>
      <Code label="What the assistant does, on its own">{`search_memory  { query: "windows arm build decision" }
related_memory { id: "a41f0c8e21b3_0" }`}</Code>
      <p>
        The first finds the decision. The second follows it sideways to everything near it in
        meaning, with no second query and no embedding call, because the vectors are already
        on disk.
      </p>

      <DocFooter href="/docs/how-it-works/" />
    </>
  );
}
