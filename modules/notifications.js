/* Web Notifications for response completion.
   100% client-side. Opt-in, privacy-respecting (no message content leaked). */

let _store = null;
let _toast = null;
let activeNotification = null;
let autoCloseTimer = null;

/**
 * Check if Web Notifications API is supported in this browser.
 */
export function isSupported() {
  return typeof window !== "undefined"
    && "Notification" in window
    && typeof Notification.requestPermission === "function";
}

/**
 * Check if notifications are permanently blocked by the browser.
 */
export function isBlocked() {
  if (!isSupported()) return false;
  return Notification.permission === "denied";
}

/**
 * Pure function: should we fire a notification right now?
 * Returns true iff tab is hidden AND permission is granted AND user enabled notifications.
 */
export function shouldNotify(visibilityState, permission, notificationsPref) {
  return visibilityState === "hidden"
    && permission === "granted"
    && notificationsPref === "enabled";
}

/**
 * Initialize the notifications module. Does NOT request permission.
 */
export function initNotifications({ store, toastFn }) {
  _store = store;
  _toast = toastFn;
}

/**
 * Request notification permission from the user.
 * Returns "granted" | "denied" | "default" | "unsupported".
 */
export async function requestNotificationPermission() {
  if (!isSupported()) return "unsupported";
  if (isBlocked()) return "denied";

  try {
    const result = await Notification.requestPermission();
    if (result === "granted" && _store) {
      const b = _store.get("behavior");
      b.notifications = "enabled";
      _store.set("behavior", b);
    } else if (result === "denied" && _toast) {
      _toast("Notificações bloqueadas pelo navegador. Para reativar, altere nas configurações do browser.", "warn", 6000);
    }
    return result;
  } catch (err) {
    if (_toast) _toast("Erro ao solicitar permissão de notificação.", "error");
    return "denied";
  }
}

/**
 * Fire a notification that the model finished responding.
 * Only fires if all three conditions are met:
 *   1. Tab is hidden (user switched away)
 *   2. Browser permission is granted
 *   3. User setting is "enabled"
 * The notification body is always generic — no message content leaked.
 */
export function notifyResponseComplete() {
  if (!isSupported() || !_store) return;

  const pref = _store.get("behavior")?.notifications;
  if (!shouldNotify(document.visibilityState, Notification.permission, pref)) return;

  // Close previous notification
  if (activeNotification) {
    try { activeNotification.close(); } catch {}
    activeNotification = null;
  }
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  try {
    const n = new Notification("Offline AI Chat", {
      body: "O modelo terminou de responder.",
      icon: "/favicon.ico",
    });

    n.onclick = () => {
      window.focus();
      n.close();
    };
    n.onclose = () => {
      if (activeNotification === n) activeNotification = null;
      if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
    };

    activeNotification = n;
    autoCloseTimer = setTimeout(() => n.close(), 8000);
  } catch (err) {
    console.warn("[Notifications] Failed to create notification:", err);
  }
}
