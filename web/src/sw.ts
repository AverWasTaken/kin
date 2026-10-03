/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA fallback for navigations, but never for the API.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  badge?: number;
}

type BadgeNavigator = WorkerNavigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  const nav = self.navigator as BadgeNavigator;
  const tasks: Promise<unknown>[] = [
    self.registration.showNotification(data.title ?? "Kin", {
      body: data.body ?? "",
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url ?? "/" },
    }),
  ];
  if (typeof data.badge === "number" && nav.setAppBadge) {
    tasks.push(data.badge > 0 ? nav.setAppBadge(data.badge) : (nav.clearAppBadge?.() ?? Promise.resolve()));
  }
  event.waitUntil(Promise.all(tasks).catch(() => {}));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          if (w.url !== target && "navigate" in w) await w.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
