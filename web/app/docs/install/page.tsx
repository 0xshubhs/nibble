import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Code, DocFooter, DocHead, Table } from '@/components/ui';
import { LATEST } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Install',
  description: 'Every build, what each one writes, and the first-launch warning on each OS.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="start here"
        title="Install"
        lede="Three platforms, six artifacts, and one decision to make: portable or installed."
      />

      <p>
        Grab the build for your OS from the{' '}
        <a href={LATEST}>latest release</a>. Each tag is compiled by GitHub Actions on its own
        native runner, because a macOS app cannot be built on Linux and a signed Windows
        binary cannot be produced anywhere else.
      </p>

      <h2 id="macos">macOS</h2>
      <p>
        Open the <code>.dmg</code> and drag the app to Applications, or run it from wherever
        you unpacked it. Both Apple silicon and Intel builds are published, and the{' '}
        <code>.zip</code> is the same app without the disk image.
      </p>
      <Callout tone="warn" title="Unidentified developer">
        The public builds are ad-hoc signed rather than Developer ID signed, which needs a paid
        Apple account. Right-click the app and choose Open, or allow it once under System
        Settings &rarr; Privacy &amp; Security. Ad-hoc signing is not optional: Apple silicon
        refuses to launch an unsigned binary at all.
      </Callout>

      <h2 id="windows">Windows</h2>
      <p>
        The <strong>portable</strong> <code>.exe</code> is a single self-extracting binary.
        Double-click it; nothing is written to the registry and nothing is installed. The
        setup build is there for people who want a Start menu entry and an uninstaller.
      </p>
      <p>
        SmartScreen will warn about an unrecognised publisher until the binary is signed with
        a code-signing certificate. Choose More info &rarr; Run anyway, or use the source
        build.
      </p>

      <h2 id="linux">Linux</h2>
      <Code label="AppImage">{`chmod +x Nibble-0.1.0-x64.AppImage
./Nibble-0.1.0-x64.AppImage`}</Code>
      <p>
        A <code>.deb</code> and a <code>.tar.gz</code> are published too. Notifications go
        through libnotify, so a desktop without a notification daemon running will show
        nothing; the tray menu still lists what is due.
      </p>

      <h2 id="artifacts">What each build is for</h2>
      <Table
        head={['Artifact', 'Data goes to', 'Use it when']}
        rows={[
          ['macOS .dmg / .zip', 'Application Support', 'It is your own Mac'],
          ['Windows portable .exe', 'beside the .exe', 'You cannot install software, or it lives on a stick'],
          ['Windows setup .exe', '%APPDATA%', 'You want a normal install'],
          ['Linux .AppImage', 'beside the AppImage', 'Any distro, no package manager'],
          ['Linux .deb', '~/.config', 'Debian or Ubuntu, managed by apt'],
        ]}
      />
      <p>
        The rule is simple: anything portable keeps its data in a <code>nibble-data</code>{' '}
        folder next to the executable, and anything installed uses the normal per-user
        location. <Link href="/docs/storage/">Storage and portability</Link> has the details,
        including how to force either mode.
      </p>

      <h2 id="first-run">First run</h2>
      <ol>
        <li>The window opens on the Reminders tab, and the mark appears in your menu bar.</li>
        <li>
          Open <strong>Memory</strong> and turn on a capture source. Nothing is captured until
          you do.
        </li>
        <li>
          The embedding model downloads once, about 23 MB. Until it lands, search works on
          keywords alone rather than failing.
        </li>
        <li>
          Closing the window hides it. The app keeps running in the tray; Quit is in the tray
          menu.
        </li>
      </ol>

      <DocFooter href="/docs/install/" />
    </>
  );
}
