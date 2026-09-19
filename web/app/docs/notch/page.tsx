import type { Metadata } from 'next';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Notch panel',
  description: 'The macOS panel that hangs off the notch, and why every part of it is a guess.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the rest of the app"
        title="Notch panel"
        lede="A panel that drops out of the MacBook notch: search, the next reminder, a pause toggle, and a drop target."
      />

      <p>
        It is off by default; the switch is in Settings, and it only appears on macOS. Hover the
        notch and the panel opens with a search box, the next reminder and a pause toggle. Drop
        text or a file on it and that gets remembered.
      </p>

      <h2 id="no-api">There is no API for this</h2>
      <p>
        macOS exposes the notch only through <code>NSScreen.safeAreaInsets</code>, which Electron
        does not surface. So the panel is a borderless, transparent <code>NSPanel</code> pinned
        to the top centre of the internal display, and three details are what make it behave
        like part of the system rather than a window near the top of the screen:
      </p>
      <ul>
        <li>
          The window level is <code>screen-saver</code>, the only level above the menu bar.
        </li>
        <li>
          It is visible on every space and over fullscreen apps, or it vanishes the moment you
          switch desktops.
        </li>
        <li>
          Collapsed, it ignores mouse events and forwards them, so the menu bar underneath stays
          clickable. Hover is detected by polling the cursor, because a window that ignores
          mouse events cannot receive them.
        </li>
      </ul>

      <h2 id="invisible">At rest it paints nothing</h2>
      <Callout title="A drawn lip would be wrong on most machines">
        Drawing a black collapsed strip only looks right if it exactly covers the physical
        notch, and nothing can tell us how wide that is. Any guess shows up as black wings on
        one machine and a gap on another, so at rest the panel is simply invisible and only the
        hover target exists.
      </Callout>

      <h2 id="motion">How it moves</h2>
      <p>
        The panel is one silhouette clipped to a notch-shaped path: two concave flares where it
        meets the top of the screen, two convex corners at the bottom. It grows out of the
        notch and shrinks back into it, rather than sliding into view from somewhere else.
      </p>
      <p>
        There are three shapes, and they are the same sequence of path commands with different
        numbers in them. That is the whole trick: a browser will interpolate one path into
        another only when their commands line up, so the morph costs a CSS transition rather
        than a frame loop.
      </p>
      <ul>
        <li>
          <strong>Closed</strong> &mdash; the size of the notch, and invisible.
        </li>
        <li>
          <strong>Island</strong> &mdash; the notch plus a wing either side, which is the only
          thing the closed strip ever says: that something was just remembered. It grows
          sideways on the notch&apos;s own line, so it never covers anything that was not
          already the notch.
        </li>
        <li>
          <strong>Open</strong> &mdash; the full panel.
        </li>
      </ul>
      <p>
        The content is laid out at full size the whole time and is revealed by the shape, so
        opening never has to lay anything out: the only work per frame is a clip and a
        transform. Opening and closing are deliberately not the same motion &mdash; 520ms with
        the barest overshoot on the way out, 400ms with none on the way back, because a panel
        that bounces as it leaves reads as a mistake rather than as a flourish.
      </p>
      <Callout title="Opening is an intention, not an event">
        The cursor has to rest on the notch briefly before anything happens, and stray for a
        moment before it closes. Without the first, every trip to the menu bar flings the panel
        out; without the second, a hand that wobbles on the way to a button loses it mid-reach.
      </Callout>

      <h2 id="detection">Detecting a notch is a guess too</h2>
      <p>
        The obvious signal does not work: a 14-inch M3 reports a 29 point menu bar at one scaled
        resolution, while an external 1080p display reports 30. So it reads the model identifier
        instead. The panel still works on a Mac without a notch; it just hangs from the top of
        the screen, and Settings says so rather than offering a feature that will look wrong.
      </p>

      <h2 id="dev">Developing against it</h2>
      <Code>{`npx electron . --dev --notch-open`}</Code>
      <p>
        Hovering cannot be scripted, so this flag opens the panel on launch.
      </p>

      <DocFooter href="/docs/notch/" />
    </>
  );
}
