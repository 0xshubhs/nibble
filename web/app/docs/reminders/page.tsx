import type { Metadata } from 'next';
import { Callout, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Reminders',
  description: 'Repeats, snooze, sleep, daylight saving, and real system notifications.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the rest of the app"
        title="Reminders"
        lede="Native notifications from a process that is already running, which is the only way a reminder actually arrives."
      />

      <Table
        head={['Repeat', 'Means']}
        rows={[
          ['Once', 'Fires and disables itself'],
          ['Every hour', 'On the same minute past the hour'],
          ['Every day', 'At the same wall-clock time'],
          ['Weekdays', 'Monday to Friday, skipping the weekend'],
          ['Every week', 'The same weekday and time'],
          ['Every N minutes', 'A custom interval, from 1 minute to a week'],
        ]}
      />

      <h2 id="dst">Wall-clock, not elapsed time</h2>
      <p>
        A daily reminder at 9am stays at 9am across a daylight-saving change. That sounds
        obvious and is the thing naive schedulers get wrong: adding 86,400,000 milliseconds to
        a timestamp moves the reminder by an hour twice a year.
      </p>

      <h2 id="sleep">Sleep and suspend</h2>
      <p>
        Timers fire late or not at all across a suspend, so the scheduler re-checks on{' '}
        <code>resume</code> and on <code>unlock-screen</code>. Something that came due while
        the laptop was in your bag reaches you when you open it: once, not as a backlog of
        every missed occurrence.
      </p>
      <Callout title="Chunked timers">
        A single setTimeout for a reminder three weeks out is not reliable across sleep, clock
        changes and integer limits. Long waits are broken into chunks that re-arm, so the
        scheduler keeps a grip on the real time rather than trusting one very long timer.
      </Callout>

      <h2 id="snooze">Snooze</h2>
      <p>
        Snooze sets a separate override that a tick consumes, rather than moving the reminder
        itself, so a repeating reminder keeps its series after a snooze. The length is a
        setting, and it is used by both the notification button and the tray menu.
      </p>

      <h2 id="platforms">Per-platform notes</h2>
      <ul>
        <li>
          <strong>macOS</strong> supports action buttons, but only when your notification style
          is Alerts. They are silently dropped otherwise, so clicking the notification is the
          real affordance.
        </li>
        <li>
          <strong>Windows</strong> toasts need an AppUserModelID, which is set before any
          notification is shown; without it toasts are attributed to Electron itself and may not
          appear at all.
        </li>
        <li>
          <strong>Linux</strong> goes through libnotify, and actions vary by desktop, so none
          are relied on.
        </li>
      </ul>

      <h2 id="tray">The tray is the real home</h2>
      <p>
        Closing the window only hides it. The tray menu lists the next five reminders, each with
        Open and Snooze, plus the data folder and Quit. On macOS you can also hide the Dock icon
        and run it as a pure menu-bar app.
      </p>

      <DocFooter href="/docs/reminders/" />
    </>
  );
}
