import webpush from "web-push";

let ready = false;
function setup() {
  if (ready) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  ready = true;
  return true;
}

// Sends one notification to every device a user has turned notifications on for.
export async function sendToUser(sb, userId, payload) {
  if (!setup()) return 0;
  const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e) {
      // 404/410 = the device unsubscribed or the app was removed: clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.warn("push failed", e.statusCode, e.body);
    }
  }
  return sent;
}
