// Public settings the app needs to start. These values are safe to share.
export default function handler(req, res) {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    aiReady: !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)
  }));
}
