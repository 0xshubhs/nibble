import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Quick capture',
  description: 'One global hotkey that remembers the clipboard on purpose.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the rest of the app"
        title="Quick capture"
        lede="The deliberate counterpart to the clipboard source: nothing is watched, and one key press saves one thing."
      />

      <p>
        Turn it on in <strong>Settings</strong>. The default is <kbd>⌘⇧M</kbd> on macOS and{' '}
        <kbd>Ctrl+Shift+M</kbd> elsewhere. Press it anywhere, in any app, and whatever is on
        your clipboard is remembered, with a notification confirming what was stored.
      </p>

      <h2 id="why">Why it exists</h2>
      <p>
        The clipboard source is ambient: while it runs, everything you copy is stored. That is
        the right trade for some people and clearly the wrong one for others. This is the
        opposite: nothing is observed at all, and the memory only gets what you explicitly hand
        it.
      </p>
      <p>
        You can run both. Many people want the ambient source off on a work machine, and this on
        everywhere.
      </p>

      <h2 id="rules">What it will not do</h2>
      <ul>
        <li>
          <strong>Nothing on the clipboard.</strong> Fewer than eight characters and it opens
          the window instead, because a key press has to do something visible.
        </li>
        <li>
          <strong>Capture is paused.</strong> It says so in a notification and stores nothing.
          A hotkey is explicit, but someone who paused capture to handle something sensitive is
          owed the stronger reading of what pause means.
        </li>
        <li>
          <strong>It looks like a credential.</strong> The same filter the clipboard source
          uses applies here. See <Link href="/docs/capture/">Capture sources</Link>.
        </li>
        <li>
          <strong>You already saved it.</strong> The same text from the same source inside six
          hours is a duplicate, and it tells you so rather than storing it twice.
        </li>
      </ul>

      <Callout tone="warn" title="If the hotkey does not register">
        A global shortcut is exclusive: whichever app asks for it first owns it. If another app
        already holds the combination, the operating system refuses it, and Settings shows{' '}
        <strong>not registered</strong> next to the switch rather than pretending it worked.
      </Callout>

      <h2 id="tray">From the tray too</h2>
      <p>
        The same action is in the tray menu as <strong>Remember the clipboard</strong>, with the
        current shortcut shown beside it, for when your hands are already there.
      </p>

      <DocFooter href="/docs/quick-capture/" />
    </>
  );
}
