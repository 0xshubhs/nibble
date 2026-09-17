import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'What leaves the device',
  description: 'Every network call the app can make, and what turns each one on.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="under the hood"
        title="What leaves the device"
        lede="There are exactly three ways this app can touch a network, and two of them are switches you throw yourself."
      />

      <Table
        head={['Connection', 'When', 'Carries']}
        rows={[
          [
            <strong key="a">huggingface.co</strong>,
            'Once, the first time the local model is needed',
            'Nothing of yours. It is a download of the ~23 MB model, cached in your data folder',
          ],
          [
            <strong key="b">Gemini or Voyage</strong>,
            'Only if you switch the embedder to a cloud backend',
            'The text of everything captured, and every query, to be embedded',
          ],
          [
            <strong key="c">127.0.0.1</strong>,
            'Only if you turn on the MCP connector',
            'Inbound, from clients on this machine. It never leaves the loopback interface',
          ],
        ]}
      />

      <Callout title="There is no fourth">
        No account system, no sync, no telemetry, no crash reporting, no update check, and no
        analytics on this website either. The app does not phone home, because there is no home
        to phone.
      </Callout>

      <h2 id="model">The model download</h2>
      <p>
        The default backend is a quantised MiniLM that runs on your machine. It has to arrive
        once. After that it is a file in your data folder and the app is fully offline, which is
        what makes a portable install on a stick work with no network at all.
      </p>
      <p>
        There is a setting that refuses the download outright. With it off, remote models are
        disabled in the runtime itself rather than merely not requested, and the memory stays
        keyword-only until you change your mind.
      </p>

      <h2 id="cloud">The cloud backends</h2>
      <p>
        Choosing Gemini or Voyage means your captured text is sent to that company to be turned
        into vectors. This is a real trade for better recall, it is off by default, and the app
        says so in plain words at the point where you switch it. See{' '}
        <Link href="/docs/embeddings/">Embeddings</Link>.
      </p>

      <h2 id="connector">The connector</h2>
      <p>
        The MCP server binds to <code>127.0.0.1</code>, so nothing off your machine can reach
        it, on any network. It still requires a bearer token and checks the Origin header,
        because loopback is not a security boundary: other local processes and web pages you
        have open can both reach it. <Link href="/docs/connector/">MCP connector</Link> covers
        the reasoning.
      </p>
      <Callout tone="warn" title="Your MCP client is its own question">
        Once your assistant can search this memory, whatever it retrieves goes wherever that
        assistant runs. If it is a hosted model, the excerpts it pulls travel with the
        conversation. Nibble keeps the memory local; it cannot make the client local too.
      </Callout>

      <h2 id="disk">On disk</h2>
      <p>
        The memory is not encrypted. It is a JSON lines file and a binary of floats in your own
        user directory, readable by anything running as you. Full-disk encryption is the right
        layer for that, and pretending otherwise with an app-level password would mostly be
        theatre when the key would have to live beside the data.
      </p>
      <p>
        <strong>Forget</strong> tombstones a chunk immediately and <strong>Compact</strong>{' '}
        rewrites the files without it. Because there is no account, there is no copy anywhere
        else to chase.
      </p>

      <DocFooter href="/docs/privacy/" />
    </>
  );
}
