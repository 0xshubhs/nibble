import type { Metadata } from 'next';
import Link from 'next/link';
import { OsPicker } from '@/components/OsPicker';
import { Callout, Code, Table } from '@/components/ui';
import { RELEASES, VERSION } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Download',
  description: 'Builds for macOS, Windows and Linux, and what each one asks you on first launch.',
};

export default function Page() {
  return (
    <div className="wrap wrap-narrow section">
      <div className="head">
        <p className="eyebrow">v{VERSION} · MIT licensed</p>
        <h1>Download Nibble</h1>
        <p className="lede">
          Free, open source, and about 160 MB because it ships a browser engine and a
          machine-learning runtime. That is the price of one codebase that feels native on three
          platforms and searches your memory without a server.
        </p>
      </div>

      <OsPicker />

      <div style={{ marginTop: 40 }}>
        <Table
          head={['Platform', 'Files', 'Architectures']}
          rows={[
            ['macOS', '.dmg, .zip', 'Apple silicon and Intel'],
            ['Windows', 'portable .exe, setup .exe, .zip', 'x64 and ARM64'],
            ['Linux', '.AppImage, .deb, .tar.gz', 'x64 and ARM64'],
          ]}
        />
      </div>

      <h2 style={{ marginTop: 48 }}>First launch</h2>
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>macOS</h3>
          <p>
            Right-click the app and choose <strong>Open</strong>, or allow it once under System
            Settings &rarr; Privacy &amp; Security. The builds are ad-hoc signed rather than
            Developer ID signed, which needs a paid Apple account.
          </p>
        </div>
        <div className="card">
          <h3>Windows</h3>
          <p>
            SmartScreen warns about an unrecognised publisher until the binary is signed with a
            code-signing certificate. Choose <strong>More info</strong> then{' '}
            <strong>Run anyway</strong>.
          </p>
        </div>
        <div className="card">
          <h3>Linux</h3>
          <Code>{`chmod +x Nibble-${VERSION}-x64.AppImage
./Nibble-${VERSION}-x64.AppImage`}</Code>
        </div>
        <div className="card">
          <h3>Any of them</h3>
          <p>
            Nothing is captured until you turn on a source, and the app starts with everything
            off. Closing the window hides it; Quit lives in the tray menu.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <Callout title="Builds are reproducible from the tag">
          Every release is compiled by GitHub Actions on its own native runner, from the tagged
          commit, and published with checksums. You can also{' '}
          <Link href="/docs/build/">build it yourself</Link> in three commands.
        </Callout>
      </div>

      <h2 style={{ marginTop: 48 }}>Then what</h2>
      <ol className="prose" style={{ marginTop: 16 }}>
        <li>
          <Link href="/docs/capture/">Turn on a capture source</Link> in the Memory tab.
        </li>
        <li>
          <Link href="/docs/connector/">Connect your assistant</Link> with one command.
        </li>
        <li>
          Ask it something you never wrote down anywhere except in passing.
        </li>
      </ol>

      <p className="small muted" style={{ marginTop: 28 }}>
        Older versions and release notes are on the <a href={RELEASES}>releases page</a>.
      </p>
    </div>
  );
}
