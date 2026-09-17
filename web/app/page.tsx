import Link from 'next/link';
import { Demo } from '@/components/Demo';
import { Code, Table } from '@/components/ui';
import { DOCS, LATEST, REPO, VERSION } from '@/lib/site';

/* Small stroke icons, inline so the page makes no extra request. */
const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const FEATURES = [
  {
    title: 'Words and meaning, fused',
    body: 'Keyword and semantic search run together and are combined by rank, not by score. An exact term still wins, a paraphrase still lands, and below a similarity floor it says no results instead of returning everything in some order.',
    icon: icon(<><circle cx="11" cy="11" r="7" /><path d="M16.2 16.2 21 21" /></>),
    href: '/docs/search/',
  },
  {
    title: 'Indexed on your machine',
    body: 'A 23 MB model runs in its own process, downloaded once and offline afterwards. Text is searchable the instant it is captured; the vectors fill in behind it, so a model that is still downloading degrades the search instead of dropping data.',
    icon: icon(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 9h8M8 13h5" /></>),
    href: '/docs/embeddings/',
  },
  {
    title: 'Capture you can see',
    body: 'Clipboard, folders you nominate, and a global hotkey for one deliberate save. Every source has a switch, a count of what it stored, and a global pause. Anything shaped like a password is dropped before it is written.',
    icon: icon(<><path d="M5 6h6l2 2h6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /></>),
    href: '/docs/capture/',
  },
  {
    title: 'Reminders that reach you',
    body: 'Real system notifications, not web toasts. Once, hourly, daily, weekdays or weekly. Timers are re-checked when the machine wakes, so something that came due in your bag still arrives, once, rather than as a backlog.',
    icon: icon(<><path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></>),
    href: '/docs/reminders/',
  },
  {
    title: 'Follow a thought sideways',
    body: 'Every result can open its nearest neighbours: the other things you captured that sit close to it in meaning, even when they share no words. Your assistant gets the same move as a tool, so it can follow a thread without asking you.',
    icon: icon(<><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="6" r="2.6" /><circle cx="18" cy="18" r="2.6" /><path d="M8.3 10.8 15.6 7.2M8.3 13.2l7.3 3.6" /></>),
    href: '/docs/search/',
  },
  {
    title: 'Forget, properly',
    body: 'Forget one result, or everything a source ever captured. Compact rewrites the files without it. There is no account, so there is no copy anywhere else to chase down.',
    icon: icon(<><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
    href: '/docs/storage/',
  },
];

const QUESTIONS = [
  ['What did I promise to send by Friday?', 'clipboard'],
  ['What did we decide about ARM builds?', 'folders'],
  ['Which key did I say needed rotating?', 'folders'],
  ['Where did I leave off on this?', 'assistant'],
  ['What was that link about notarizing?', 'clipboard'],
  ['Why did we pick this library?', 'folders'],
  ['What do I keep re-explaining?', 'assistant'],
  ['What was I worried about last month?', 'clipboard'],
];

export default function Home() {
  return (
    <>
      {/* ---------------- hero ---------------- */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="live-tag">
              <span className="dot" /> indexing on this device
            </span>
            <h1>
              Stop explaining
              <br />
              yourself <span className="hl hl-block">to your AI.</span>
            </h1>
            <p className="lede">
              Nibble is a small app in your menu bar that remembers what you copy, write and
              keep. It indexes all of it on your own machine, then hands it to Claude, ChatGPT
              or any MCP client as a tool they can search. No account, no server, nothing
              uploaded.
            </p>
            <div className="row">
              <a className="btn btn-primary" href={LATEST}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
                </svg>
                Download
              </a>
              <Link className="btn btn-outline" href="/docs/">
                Read the docs
              </Link>
            </div>
            <p className="small muted">
              MIT licensed · v{VERSION} · macOS, Windows &amp; Linux
            </p>
          </div>

          <Demo />
        </div>
      </section>

      {/* ---------------- the questions ---------------- */}
      <section className="section section-sunken">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">what you can finally ask</p>
            <h2>Questions your assistant could never answer.</h2>
            <p className="lede">
              Not because the model is not clever enough, but because the answer was in
              something you copied three weeks ago and never pasted anywhere.
            </p>
          </div>
          <div className="row">
            {QUESTIONS.map(([q, src]) => (
              <span className="pill" key={q}>
                {q}
                <span className="pill pill-solid">{src}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- how ---------------- */}
      <section className="section" id="how">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">how it works</p>
            <h2>Three steps, then forget it exists.</h2>
          </div>
          <div className="steps">
            <div className="card step">
              <span className="step-n">1</span>
              <h3>No installer, no account</h3>
              <p>
                Mount the <code>.dmg</code>, run the portable <code>.exe</code>, or{' '}
                <code>chmod +x</code> the AppImage. The mark appears in your menu bar and
                stays there.
              </p>
            </div>
            <div className="card step">
              <span className="step-n">2</span>
              <h3>Turn on a source</h3>
              <p>
                Clipboard, folders you nominate, or a hotkey you press on purpose. Everything
                is chunked and indexed locally: searchable the moment it lands, embedded a
                beat later.
              </p>
            </div>
            <div className="card step">
              <span className="step-n">3</span>
              <h3>Paste one line</h3>
              <p>
                Add the connector to Claude, ChatGPT or anything else that speaks MCP. From
                then on it looks things up instead of asking you to explain again.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- features ---------------- */}
      <section className="section section-sunken" id="features">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">what it does</p>
            <h2>A memory that stays on your machine.</h2>
          </div>
          <div className="grid grid-3">
            {FEATURES.map((f, i) => (
              <Link className="card" href={f.href} key={f.title}>
                <span className={`card-icon${i % 2 ? ' is-solid' : ''}`}>{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- the design system ---------------- */}
      <section className="section" id="ui">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">one design system</p>
            <h2>
              The app and this page are built from the{' '}
              <span className="hl">same parts</span>.
            </h2>
            <p className="lede">
              Components from the ENS design system, Thorin, with the colour taken out: pill
              buttons, tag pills, segmented tabs, switches. One set of tokens defines them for
              the window, the notch panel and this page, so nothing drifts.
            </p>
          </div>

          <div className="ui-demo">
            <div className="ui-cell">
              <h4>Search</h4>
              <div className="ui-input">
                <span>Search what you captured</span>
                <span className="spacer" />
                <span className="btn btn-primary btn-sm">Find</span>
              </div>
              <p className="small muted">
                A pill field, as in the app&apos;s Memory tab and the notch panel.
              </p>
            </div>

            <div className="ui-cell">
              <h4>Tabs</h4>
              <div className="ui-tabs">
                <span className="ui-tab is-active">Reminders</span>
                <span className="ui-tab">Memory</span>
                <span className="ui-tab">Settings</span>
              </div>
              <p className="small muted">A segmented control on a hard track. Three tabs, no menus.</p>
            </div>

            <div className="ui-cell">
              <h4>Switches</h4>
              <div className="ui-switch-row">
                <span>Clipboard capture</span>
                <span className="ui-switch is-on" />
              </div>
              <div className="ui-switch-row">
                <span>Quick capture hotkey</span>
                <span className="ui-switch is-on" />
              </div>
              <div className="ui-switch-row">
                <span>Send anything to a cloud</span>
                <span className="ui-switch" />
              </div>
            </div>

            <div className="ui-cell">
              <h4>Status</h4>
              <div className="row">
                <span className="pill pill-solid">live</span>
                <span className="pill">words + meaning</span>
                <span className="pill pill-quiet">phase 2</span>
                <span className="pill">clipboard</span>
              </div>
              <p className="small muted">
                Every state is a shape or a fill, never a colour, so it survives a monochrome
                screen and a colour-blind reader alike.
              </p>
            </div>

            <div className="ui-cell">
              <h4>Indexing</h4>
              <div className="ui-meter">
                <span style={{ width: '72%' }} />
              </div>
              <p className="small muted">
                1,284 of 1,790 chunks embedded. Text is searchable before this finishes.
              </p>
            </div>

            <div className="ui-cell">
              <h4>Actions</h4>
              <div className="row">
                <span className="btn btn-primary btn-sm">Remember it</span>
                <span className="btn btn-sm">Related</span>
                <span className="btn btn-sm">Forget</span>
              </div>
              <p className="small muted">
                Three verbs, in the order you actually use them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- connector ---------------- */}
      <section className="section" id="connect">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">connect your llm</p>
            <h2>
              One line, then your AI can just{' '}
              <span className="hl hl-block">ask</span>.
            </h2>
            <p className="lede">
              Nibble speaks MCP, so any client that takes a connector can search your memory as
              a tool, follow a result to what is near it, and schedule reminders while it is
              there.
            </p>
          </div>

          <Code label="Claude Code">
            claude mcp add nibble -- node /path/to/nibble/mcp/stdio.js
          </Code>

          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>Seven tools</h3>
              <p style={{ marginBottom: 14 }}>
                Everything the window can do, your assistant can do too.
              </p>
              <div className="row">
                {['search_memory', 'related_memory', 'recent_memory', 'remember', 'memory_stats', 'list_reminders', 'add_reminder'].map((t) => (
                  <span className="pill pill-solid" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>
                Locked to this machine <span className="pill pill-solid">127.0.0.1</span>
              </h3>
              <p>
                Bound to loopback, so nothing off-box can reach it. Every request needs a
                bearer token, because anything running locally, including a web page you have
                open, can also talk to localhost. The Origin header is checked for the same
                reason.
              </p>
              <p style={{ marginTop: 12 }}>
                <Link href="/docs/connector/" className="linky">
                  Connector setup &rarr;
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- platforms ---------------- */}
      <section className="section section-sunken" id="platforms">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">downloads</p>
            <h2>One codebase, three real builds.</h2>
            <p className="lede">
              Every tagged release is compiled by GitHub Actions on its own native runner and
              published with checksums.
            </p>
          </div>
          <Table
            head={['Platform', 'File', 'How it runs', '']}
            rows={[
              [
                'macOS',
                <>
                  .dmg<span className="sub">also .zip</span>
                </>,
                <>
                  Drag to Applications, or run it from anywhere
                  <span className="sub">Apple silicon &amp; Intel</span>
                </>,
                <span className="pill">Drag &amp; drop</span>,
              ],
              [
                'Windows',
                <>
                  portable .exe<span className="sub">also an installer</span>
                </>,
                <>
                  Double-click. Nothing is written to the registry
                  <span className="sub">x64 &amp; ARM64</span>
                </>,
                <span className="pill pill-solid">Portable</span>,
              ],
              [
                'Linux',
                <>
                  .AppImage<span className="sub">also .deb, .tar.gz</span>
                </>,
                <>
                  <code>chmod +x</code> and run, on any distro
                  <span className="sub">x64 &amp; ARM64</span>
                </>,
                <span className="pill pill-solid">Portable</span>,
              ],
            ]}
          />
          <p className="small muted" style={{ marginTop: 16 }}>
            Builds are unsigned by default, so the first launch needs one confirmation.{' '}
            <Link href="/download/" className="linky">
              What each OS asks you &rarr;
            </Link>
          </p>
        </div>
      </section>

      {/* ---------------- docs ---------------- */}
      <section className="section">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">documentation</p>
            <h2>Everything, explained.</h2>
            <p className="lede">
              How each part works and why it was built that way, including the parts that are
              a compromise.
            </p>
          </div>
          <div className="grid grid-3">
            {DOCS.map((group) => (
              <div className="card" key={group.title}>
                <h3>{group.title}</h3>
                <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                  {group.pages.map((p) => (
                    <Link key={p.href} href={p.href} className="linky small">
                      {p.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- cta ---------------- */}
      <section className="section-tight">
        <div className="wrap">
          <div className="cta">
            <p className="eyebrow">get it</p>
            <h2>Put it in your menu bar and stop thinking about it.</h2>
            <p className="lede">Free, MIT licensed, and small enough to read end to end.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <a className="btn btn-primary" href={LATEST}>
                Download for free
              </a>
              <a className="btn btn-outline" href={REPO}>
                Read the source
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
