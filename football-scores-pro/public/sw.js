/* global self, clients */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || "Football Scores Pro";
  const body = data.body || "";
  const copyText = data.copyText || "";
  const tag = data.tag || ("evt-" + Date.now());

  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: false,
    data: { copyText },
    actions: [
      { action: "copy", title: "Copy" },
      { action: "open", title: "Open" }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

async function focusOrOpenClient() {
  const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  if (allClients && allClients.length) {
    const c = allClients[0];
    await c.focus();
    return c;
  }
  return clients.openWindow("/");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const copyText = event.notification.data?.copyText || "";

  event.waitUntil((async () => {
    const client = await focusOrOpenClient();
    if (event.action === "copy" && client) {
      // Clipboard write must occur in page context, so we message the page.
      client.postMessage({ type: "COPY_TO_CLIPBOARD", text: copyText });
      return;
    }
    if (client) client.focus();
  })());
});
