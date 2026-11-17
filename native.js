import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

function makeNotificationId(noteId) {
  // Stable positive 31-bit integer based on the note ID.
  let hash = 2166136261;
  for (let i = 0; i < noteId.length; i++) {
    hash ^= noteId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

async function requestPermission() {
  if (!isNativeAndroid) {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      return result === 'granted';
    }
    return false;
  }

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') {
    permission = await LocalNotifications.requestPermissions();
  }
  const granted = permission.display === 'granted';
  if (granted && isNativeAndroid) {
    try {
      const saved = JSON.parse(localStorage.getItem('pulse.v1') || '{}');
      await syncReminders(saved.notes || []);
    } catch (error) {
      console.error('Could not reschedule Pulse reminders:', error);
    }
  }
  return granted;
}

async function syncReminders(notes = []) {
  if (!isNativeAndroid) return;

  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(item => ({ id: item.id }))
      });
    }

    const now = Date.now();
    const upcoming = notes
      .filter(note => note.rem && !note.ack && !note.del && Number(note.rem) > now)
      .slice(0, 100);

    if (!upcoming.length) return;

    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') return;

    await LocalNotifications.schedule({
      notifications: upcoming.map(note => ({
        id: makeNotificationId(String(note.id)),
        title: note.title || 'Pulse reminder',
        body: (note.body || 'You have a reminder.') .slice(0, 180),
        schedule: {
          at: new Date(Number(note.rem)),
          allowWhileIdle: true
        },
        extra: { pulseNoteId: note.id }
      }))
    });
  } catch (error) {
    console.error('Pulse reminder sync failed:', error);
  }
}

window.PulseNative = {
  isNativeAndroid,
  requestPermission,
  syncReminders
};

// The original page loads its own saved data before this module runs.
// Read it once here so reminders created earlier are also scheduled.
try {
  const saved = JSON.parse(localStorage.getItem('pulse.v1') || '{}');
  syncReminders(saved.notes || []);
} catch (error) {
  console.error('Could not read Pulse notes:', error);
}
