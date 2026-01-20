import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const store = getStore("push-subs");

// Set env vars in Netlify:
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
function ensureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Missing VAPID keys in env");
  webpush.setVapidDetails("mailto:admin@example.com", pub, priv);
  return { pub, priv };
}

export async function handler(event) {
  const { pub } = ensureVapid();

  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ vapidPublicKey: pub })
    };
  }

  if (event.httpMethod === "POST") {
    const payload = JSON.parse(event.body || "{}");
    const sub = payload.subscription;
    const prefs = payload.prefs || {};
    if (!sub?.endpoint) return { statusCode: 400, body: "Missing subscription" };

    await store.set(sub.endpoint, JSON.stringify({ subscription: sub, prefs, updatedAt: Date.now() }));

    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ ok: true })
    };
  }

  return { statusCode: 405, body: "Method not allowed" };
}
