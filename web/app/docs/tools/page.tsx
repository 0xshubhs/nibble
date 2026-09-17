import type { Metadata } from 'next';
import { Code, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Tool reference',
  description: 'The seven MCP tools, their arguments, and what they return.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="connect an llm"
        title="Tool reference"
        lede="Everything the window can do, your assistant can do too. These are the exact tools the connector registers."
      />

      <Table
        head={['Tool', 'Arguments', 'What it does']}
        rows={[
          [
            <code key="a">search_memory</code>,
            <>
              <code>query</code>, <code>limit</code>, <code>source</code>,{' '}
              <code>since_days</code>
            </>,
            'Keyword and semantic search together. Returns the excerpt, the source, the time, how it matched, and the chunk id.',
          ],
          [
            <code key="b">related_memory</code>,
            <>
              <code>id</code>, <code>limit</code>
            </>,
            'The nearest neighbours of a chunk, by meaning. Takes an id printed by search_memory, and returns each match with a similarity percentage.',
          ],
          [
            <code key="c">recent_memory</code>,
            <>
              <code>limit</code>, <code>source</code>
            </>,
            'The newest captures first, for "what was I just doing" questions.',
          ],
          [
            <code key="d">remember</code>,
            <>
              <code>text</code>, <code>title</code>
            </>,
            'Stores something from the conversation, tagged as coming from the assistant.',
          ],
          [
            <code key="e">memory_stats</code>,
            <>&mdash;</>,
            'How much is stored, how much is indexed, which model, and how much text.',
          ],
          [
            <code key="f">list_reminders</code>,
            <>&mdash;</>,
            'Scheduled reminders, soonest first, with their repeat rule.',
          ],
          [
            <code key="g">add_reminder</code>,
            <>
              <code>title</code>, <code>at</code>, <code>body</code>, <code>repeat</code>,{' '}
              <code>interval_minutes</code>
            </>,
            'Schedules a real system notification.',
          ],
        ]}
      />

      <h2 id="ids">Why results carry an id</h2>
      <p>
        Every hit from <code>search_memory</code> prints its chunk id. That is what makes
        following a thread possible without a second search: the model reads a result, decides
        it wants the material around it, and calls <code>related_memory</code> with the id it
        already has.
      </p>
      <Code label="a typical pair of calls">{`search_memory  { query: "why did we drop the arm build" }
  [1] Standup notes: folders, 2026-09-12 (matched on both, id a41f0c8e21b3_0)
      We are cutting the Windows ARM build until someone asks for it...

related_memory { id: "a41f0c8e21b3_0" }
  [1] CI minutes: folders, 2026-09-12 (71% similar, id 9d2c1b77aa04_1)
  [2] Clipboard: 2026-09-11 (64% similar, id 55ab90ff1c22_0)`}</Code>

      <h2 id="times">Times are absolute</h2>
      <p>
        <code>add_reminder</code> takes an ISO 8601 datetime and nothing else. Relative phrases
        like &quot;tomorrow at 9&quot; are the client&apos;s job to resolve, in your local
        timezone, before calling. A time in the past is rolled forward to the next real slot if
        the reminder repeats, and refused with an explanation if it does not.
      </p>

      <h2 id="same-path">One path in</h2>
      <p>
        A reminder scheduled by an assistant goes through exactly the same validation and
        roll-forward as one typed into the window, because both call the same function in the
        main process. There is no second, looser path into your data.
      </p>

      <DocFooter href="/docs/tools/" />
    </>
  );
}
