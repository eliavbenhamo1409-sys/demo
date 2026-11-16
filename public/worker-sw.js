/*
 * The worker phone's service worker: it only shows what the manager sends and opens it.
 * Registered by src/lib/push.ts with scope /worker; it never touches the network on its own,
 * so pages load exactly as they would without it.
 *
 * A push carries { title, body, url, tag, ack }: `ack` is the fault-push function's signed
 * address for "קיבלתי", so the notification's button works without opening the app.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  // A phone must show every push it gets, or the browser stops delivering them.
  event.waitUntil(
    self.registration.showNotification(data.title || "משימה מהמנהל", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      dir: "rtl",
      lang: "he",
      icon: "/app-icons/icon-192.png",
      data,
      actions: data.ack ? [{ action: "ack", title: "קיבלתי" }] : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  if (event.action === "ack" && data.ack) {
    event.waitUntil(fetch(data.ack, { method: "POST" }).catch(() => undefined));
    return;
  }

  const target = new URL(data.url || "/worker", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).pathname.startsWith("/worker"));
      if (!open) {
        await self.clients.openWindow(target);
        return;
      }
      await open.focus();
      try {
        if (await open.navigate(target)) return;
      } catch {
        /* a window this worker doesn't control yet can't be moved from here */
      }
      // PushBridge in the worker layout moves it instead.
      open.postMessage({ type: "open", url: target });
    })(),
  );
});
