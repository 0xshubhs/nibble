import type { Metadata } from 'next';
import Link from 'next/link';
import { LATEST } from '@/lib/site';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'The questions worth asking before you download it, answered honestly.',
};

const QA: Array<{ q: string; a: React.ReactNode; open?: boolean }> = [
  {
    open: true,
    q: 'Does anything actually leave my machine?',
    a: (
      <>
        With the default settings, no. The embedding model is downloaded once, about 23 MB, and
        then runs locally; the index is two files on your disk; the connector is bound to{' '}
        <code>127.0.0.1</code>. There is no account and no server to sync to. If you switch the
        embedder to Gemini or Voyage in Settings, your text does go to them. That is the trade,
        it is off by default, and <Link href="/docs/privacy/">every connection is listed</Link>.
      </>
    ),
  },
  {
    q: 'How is this different from pasting context into the chat?',
    a: (
      <>
        You do not have to remember what to paste. Your assistant searches the memory itself,
        as a tool, when the question calls for it, including things you copied weeks ago and
        forgot you had. It can also follow a result sideways to whatever is near it in meaning,
        which is not a thing you can do by pasting.
      </>
    ),
  },
  {
    q: 'What stops it from storing my passwords?',
    a: (
      <>
        The clipboard source drops anything matching a known credential shape: private keys, API
        tokens, JWTs, card-shaped digit runs, plus anything that looks like a high-entropy
        random string. It is biased towards throwing away something harmless rather than storing
        a secret. It is a safety net, not a guarantee, which is why <strong>Forget</strong> is on
        every result. <Link href="/docs/capture/">The full list of patterns</Link>.
      </>
    ),
  },
  {
    q: 'Can it record my meetings and my screen?',
    a: (
      <>
        Not yet, and it says so in the app rather than implying otherwise. Audio is the next
        phase and screen capture the one after. When they land they get a visible indicator
        whenever they are running, a one-click pause, and frames that are read and discarded
        rather than stored. Screen capture gets the strictest treatment, because Windows and
        Linux do not gate it behind any OS permission.
      </>
    ),
  },
  {
    q: 'Which assistants work with it?',
    a: (
      <>
        Anything that speaks MCP. Claude Code and Claude Desktop spawn the stdio relay; anything
        that takes a URL gets <code>http://127.0.0.1:8787/mcp</code> with a bearer token. See{' '}
        <Link href="/docs/connector/">the connector docs</Link>.
      </>
    ),
  },
  {
    q: 'Does it work offline?',
    a: (
      <>
        Completely, once the model has been downloaded. That is the reason the local backend is
        the default: capture, indexing, search and reminders all run with the network off. The
        website you are reading loads no third-party scripts or fonts either.
      </>
    ),
  },
  {
    q: 'Why is the download about 160 MB?',
    a: (
      <>
        It ships a browser engine and a machine-learning runtime. That is the trade for one
        codebase producing a native-feeling app on all three platforms, with on-device search,
        and no runtime to install first.
      </>
    ),
  },
  {
    q: 'macOS says it is from an unidentified developer.',
    a: (
      <>
        The public builds are ad-hoc signed, not Developer ID signed, which needs a paid Apple
        account. Right-click the app and choose <em>Open</em>, or allow it once under{' '}
        <strong>System Settings &rarr; Privacy &amp; Security</strong>. Adding a certificate to
        the CI secrets makes the warning go away for everyone.
      </>
    ),
  },
  {
    q: 'Can I run it on a machine I do not own?',
    a: (
      <>
        That is what the portable builds are for. No installer, no admin rights, no registry
        writes: the memory, the model and the index all live in a folder beside the executable.
        Take the folder with you and the machine is as you found it.{' '}
        <Link href="/docs/storage/">How portable mode is decided</Link>.
      </>
    ),
  },
  {
    q: 'Is my memory encrypted on disk?',
    a: (
      <>
        No. It is a JSON lines file and a binary of floats in your own user directory. Full-disk
        encryption is the right layer for that; an app-level password would mostly be theatre
        when the key has to live beside the data.
      </>
    ),
  },
  {
    q: 'How much can it hold?',
    a: (
      <>
        Comfortably tens of thousands of chunks. Search is a linear scan over the vectors, which
        is fast at that size and would not be at millions. If you need that, you need a real
        vector database, and this is deliberately not one.
      </>
    ),
  },
  {
    q: 'Can I build it myself?',
    a: (
      <>
        Clone the repo, <code>npm install</code>, then <code>npm run build:mac</code>,{' '}
        <code>build:win</code> or <code>build:linux</code>. Each target builds natively, so use
        the CI workflow if you need all three from one machine.{' '}
        <Link href="/docs/build/">Build and release</Link>.
      </>
    ),
  },
];

export default function Page() {
  return (
    <div className="wrap wrap-narrow section">
      <div className="head">
        <p className="eyebrow">questions</p>
        <h1>Before you download it.</h1>
        <p className="lede">
          Including the answers that are not flattering, because those are the ones worth
          reading.
        </p>
      </div>

      <div className="faq">
        {QA.map((item) => (
          <details key={item.q} open={item.open}>
            <summary>{item.q}</summary>
            <div className="answer">{item.a}</div>
          </details>
        ))}
      </div>

      <div className="cta" style={{ marginTop: 48 }}>
        <h2>Still curious?</h2>
        <p className="lede">The docs go through every part of it, including the compromises.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" href="/docs/">
            Read the docs
          </Link>
          <a className="btn btn-outline" href={LATEST}>
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
