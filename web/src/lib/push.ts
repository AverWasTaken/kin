import { api } from "./client";
import { getKin, toast } from "./store";
import { isIOS, isStandalone } from "./viewport";

export type PushState = "unsupported" | "needs-install" | "default" | "granted" | "denied";

export function pushState(): PushState {
  if (isIOS && !isStandalone) return "needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return Notification.permission === "default" ? "default" : Notification.permission;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission and registers this device for push. Must run from a tap. */
export async function enablePush(): Promise<PushState> {
  const state = pushState();
  if (state === "needs-install" || state === "unsupported") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "default";
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = getKin().vapidPublicKey;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    await api.pushSubscribe(sub.toJSON());
    toast("Notifications are on");
  } catch (err) {
    toast(err instanceof Error ? `Couldn't turn on notifications: ${err.message}` : "Couldn't turn on notifications");
  }
  return "granted";
}
