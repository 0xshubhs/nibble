import path from 'path';
import { Notification, nativeImage } from 'electron';

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

/**
 * Native notifications, with the per-platform quirks handled in one place:
 *
 *   Windows  toasts need an AppUserModelID (set in index.ts) and only show an
 *            icon from the packaged app's shortcut, so we pass one anyway.
 *   macOS    supports action buttons, but only when the user's notification
 *            style is "Alerts"; the buttons are silently dropped otherwise.
 *   Linux    goes through libnotify; actions vary by desktop, so we do not
 *            rely on them and keep the click handler as the real affordance.
 */

export interface NotifiablePayload {
  id?: string;
  title?: string;
  body?: string;
}

export interface FireOptions {
  sound: boolean;
  snoozeMinutes: number;
  onOpen(id: string): void;
  onSnooze(id: string, minutes: number): void;
}

export function supported(): boolean {
  return Notification.isSupported();
}

export function fire(reminder: NotifiablePayload, opts: FireOptions): Notification | null {
  if (!supported()) return null;

  const options: Electron.NotificationConstructorOptions = {
    title: reminder.title || 'Reminder',
    body: reminder.body ?? '',
    silent: !opts.sound,
    timeoutType: 'never',
    icon: nativeImage.createFromPath(ICON),
  };

  if (process.platform === 'darwin') {
    options.actions = [{ type: 'button', text: `Snooze ${opts.snoozeMinutes}m` }];
    options.closeButtonText = 'Dismiss';
  }

  const n = new Notification(options);
  const id = reminder.id ?? '';
  n.on('click', () => opts.onOpen(id));
  n.on('action', () => opts.onSnooze(id, opts.snoozeMinutes));
  n.show();
  return n;
}
