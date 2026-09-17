import type { Metadata } from 'next';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Search and recall',
  description: 'BM25, cosine similarity, rank fusion, the similarity floor, and nearest neighbours.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the memory"
        title="Search and recall"
        lede="Two searches run on every query and are combined by rank, so an exact term still wins and a paraphrase still lands."
      />

      <h2 id="keyword">The keyword half</h2>
      <p>
        A dependency-free BM25 over an inverted index that is rebuilt at load, in a few
        milliseconds. The tokeniser lowercases, splits on anything that is not a letter or
        digit, drops a small stopword list, and does one crude stemming step so that{' '}
        <code>reminders</code> matches <code>reminder</code>.
      </p>
      <p>
        This half is why capture never has to wait for the embedder: a chunk is findable by
        keyword the instant it is written.
      </p>

      <h2 id="semantic">The semantic half</h2>
      <p>
        Vectors are stored normalised, so cosine similarity is a dot product over the rows of{' '}
        <code>vectors.bin</code>. Rows that are not embedded yet, and rows that are tombstoned,
        are skipped.
      </p>

      <h3 id="floor">The floor</h3>
      <p>
        Anything under a cosine of <strong>0.1</strong> is dropped rather than ranked. Without a
        floor, every query returns the entire corpus in some order, which looks exactly like a
        search engine that cannot say no.
      </p>
      <Callout title="The number was measured, not guessed">
        Across question and document pairs for this model, genuinely related pairs scored 0.12
        to 0.46 and unrelated ones scored -0.04 to 0.04, so the floor sits in the gap. An
        earlier value of 0.25 was inside the related range and silently dropped real matches: a
        paraphrased question returned nothing even though the answer was indexed.
      </Callout>

      <h2 id="fusion">Fusing the two</h2>
      <p>
        The two ranked lists are combined with Reciprocal Rank Fusion. Each list contributes{' '}
        <code>1 / (60 + rank)</code> to a document, and the sums are sorted.
      </p>
      <Code>{`score(doc) = 1 / (60 + rank_bm25(doc)) + 1 / (60 + rank_cosine(doc))`}</Code>
      <p>
        Fusing positions instead of scores means BM25 numbers, which are unbounded, and
        cosines, which live in a fixed range, never have to be reconciled. It also has a useful
        bias: something both methods like outranks something only one of them loves.
      </p>
      <p>
        Every result carries how it was found, and the app shows it as a pill:{' '}
        <strong>words</strong>, <strong>meaning</strong>, or <strong>words + meaning</strong>.
      </p>

      <h2 id="related">Nearest neighbours</h2>
      <p>
        Search answers a question. <strong>Related</strong> answers a different one: what else
        is near this? Every result in the window has a Related button, and the connector
        exposes the same thing as <code>related_memory</code>.
      </p>
      <p>Three things make it cheap and worth having:</p>
      <ul>
        <li>
          The stored chunk&apos;s own vector is the query, so there is no embedding call, no
          network, and no latency even with a cloud backend configured.
        </li>
        <li>
          The floor is higher than for search, at <strong>0.25</strong>. Both sides are full
          passages here rather than a short question, so they sit higher on the cosine scale,
          and the search floor would let in anything that merely shares a topic.
        </li>
        <li>
          Chunks split from the same original capture are dropped. They are the rest of the
          same paragraph, they always score highest, and they would fill the list with text you
          are already looking at.
        </li>
      </ul>

      <h2 id="filters">Filters</h2>
      <p>
        Search takes a source and a date window, both of which the connector exposes as
        arguments: <code>source: &quot;clipboard&quot;</code> to look only at what you copied,{' '}
        <code>since_days: 7</code> for the last week.
      </p>

      <DocFooter href="/docs/search/" />
    </>
  );
}
