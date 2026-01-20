import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const store = getStore("push-subs");

function ensureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Missing VAPID keys in env");
  webpush.setVapidDetails("mailto:admin@example.com", pub, priv);
}

export async function handler(event) {
  ensureVapid();
  const body = JSON.parse(event.body || "{}");

  const list = await store.list();
  const keys = list.blobs?.map(b => b.key) || [];

  const msg = body.test
    ? { title: "Test", body: "Push is working.", copyText: "$ end match", tag: "test" }
    : body;

  let sent = 0;
  for (const key of keys) {
    const raw = await store.get(key);
    if (!raw) continue;
    const { subscription } = JSON.parse(raw);
    try {
      await webpush.sendNotification(subscription, JSON.stringify(msg));
      sent++;
    } catch {
      await store.delete(key);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
}
