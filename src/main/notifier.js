'use strict';
const path = require('path');
const { Notification, nativeImage } = require('electron');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

/**
 * Native notifications, with the per-platform quirks handled in one place:
 *
 *   Windows  toasts need an AppUserModelID (set in index.js) and only show an
 *            icon from the packaged app's shortcut, so we pass one anyway.
 *   macOS    supports action buttons, but only when the user's notification
 *            style is "Alerts"; the buttons are silently dropped otherwise.
 *   Linux    goes through libnotify; actions vary by desktop, so we do not
 *            rely on them and keep the click handler as the real affordance.
 */

function supported() {
  return Notification.isSupported();
}

/**
 * @param {object} reminder
 * @param {object} opts
 * @param {boolean} opts.sound
 * @param {number} opts.snoozeMinutes
 * @param {(id: string) => void} opts.onOpen
 * @param {(id: string, minutes: number) => void} opts.onSnooze
 */
function fire(reminder, { sound, snoozeMinutes, onOpen, onSnooze }) {
  if (!supported()) return null;

  const options = {
    title: reminder.title || 'Reminder',
    body: reminder.body || '',
    silent: !sound,
    timeoutType: 'never',
    icon: nativeImage.createFromPath(ICON),
  };

  if (process.platform === 'darwin') {
    options.actions = [{ type: 'button', text: `Snooze ${snoozeMinutes}m` }];
    options.closeButtonText = 'Dismiss';
  }

  const n = new Notification(options);
  n.on('click', () => onOpen(reminder.id));
  n.on('action', () => onSnooze(reminder.id, snoozeMinutes));
  n.show();
  return n;
}

module.exports = { fire, supported };
