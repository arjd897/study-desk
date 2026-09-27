import { admin, requireUser, send } from "../lib/server.js";
import { sendToUser } from "../lib/push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { message: "Please sign in again." });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return send(res, 500, { message: "Push keys are not set on the server yet (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)." });
  }
  const n = await sendToUser(admin(), user.id, {
    title: "Study Desk is connected",
    body: "You'll get your daily picks and new-paper alerts here.",
    url: "/#home"
  });
  send(res, 200, { sent: n });
}
