# Study Desk: your personal AI/ML teacher app

Everything here runs on **free plans**. No credit card is needed for any step.

What the app does:

- **For you:** 6 personal picks every morning, based on your weak areas, your test marks and what you've already learned.
- **New:** the most upvoted new AI papers from Hugging Face every day, explained in simple English.
- **Explore:** type any topic and get a study path from basics to research papers.
- **Lessons:** simple explanations with analogies, key terms and interview questions. System design lessons include an architecture diagram and a trade-offs table.
- **Tests:** 5-question tests with marks, and explanations for every answer.
- **Glossary and Progress:** your saved terms, and your marks by area.
- **Notifications:** a morning alert on your phone with your picks and new papers.

---

## How it fits together

```
 Your phone (app)  ──►  Vercel (website + /api)  ──►  Gemini AI (free)
        │                        │                      Groq AI (free backup)
        └──────────►  Supabase (login + database, free)
                                 ▲
 GitHub Actions (free, 7 AM daily) ──► finds new papers, makes your picks, sends notifications
```

| Service | What it does here | Free limit that matters |
|---|---|---|
| **Vercel** | Hosts the app and the AI endpoint | Free Hobby plan is for personal, non-commercial use |
| **Supabase** | Login and database | 500 MB database. Pauses after 7 days with no activity, but the daily job keeps it awake |
| **Google AI Studio (Gemini)** | Writes lessons, tests and picks | Free Flash models, with requests-per-minute and per-day limits |
| **Groq** (optional) | Backup AI when Gemini is busy | Free tier with its own daily limit |
| **GitHub Actions** | Runs the daily job | Free minutes are more than enough for one short job a day |

> **Privacy note:** on Gemini's free tier, Google may use your prompts to improve its products. Don't type private or company data into the app.

---

## Step 0: Install two tools on your laptop (one time)

1. **Node.js LTS** from https://nodejs.org (this includes `npx`).
2. **Git** from https://git-scm.com. You can skip this if you'll upload files on the GitHub website.

---

## Step 1: Create free accounts

1. **GitHub:** https://github.com/signup
2. **Vercel:** https://vercel.com/signup. Choose **Continue with GitHub**.
3. **Supabase:** https://supabase.com. Choose **Start your project** and sign in with GitHub.
4. **Google AI Studio:** https://aistudio.google.com with your Google account.
5. **Groq (optional backup):** https://console.groq.com

---

## Step 2: Collect your keys

Keep a notepad open and paste each key into it as you go. **Never share the secret ones.**

### 2a. Supabase (database and login)

1. In Supabase, click **New project**. Pick any name, set a database password (save it), and choose the region closest to you (for India, choose **Mumbai**).
2. Wait about 2 minutes for it to finish.
3. Open **Project Settings → API** (it may be called **API Keys** or **Data API**) and copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **anon / public** key → this is `SUPABASE_ANON_KEY` (safe to be public)
   - **service_role** key → this is `SUPABASE_SERVICE_ROLE_KEY` (**SECRET**)
4. Create the tables: open **SQL Editor → New query**, paste the whole content of `supabase/schema.sql`, and click **Run**. You should see "Success".
5. Make sign-up easy: open **Authentication → Sign In / Providers → Email** and turn **Confirm email** **off**. The free email sender is limited to a few emails per hour, so confirmations can get stuck. If you'd rather keep it on, that's fine too.

### 2b. Gemini (the AI)

1. In Google AI Studio, click **Get API key → Create API key**.
2. Copy it. This is `GEMINI_API_KEY` (**SECRET**).
3. Look at the model list in AI Studio and copy the name of the current free **Flash** model, for example `gemini-2.5-flash`. This is `GEMINI_MODEL`. Model names change over time, so always use one that AI Studio shows as free.

### 2c. Groq (optional backup AI)

1. In the Groq console, open **API Keys → Create API Key**.
2. Copy it. This is `GROQ_API_KEY` (**SECRET**). Leave `GROQ_MODEL` as `llama-3.3-70b-versatile` unless Groq's model list says otherwise.

### 2d. Notification keys

On your laptop, open a terminal and run:

```bash
npx web-push generate-vapid-keys
```

It prints two keys:
- **Public Key** → `VAPID_PUBLIC_KEY`
- **Private Key** → `VAPID_PRIVATE_KEY` (**SECRET**)

`VAPID_SUBJECT` is just `mailto:` plus your email, for example `mailto:you@gmail.com`.

---

## Step 3: Put the code on GitHub

1. On GitHub, click **New repository**. Name it `study-desk` and choose **Private**.
2. Upload the project:
   - **Easy way:** on the new repo page click **uploading an existing file**, then drag in everything from this folder, including the `.github` folder. If your computer hides it, use the Git way.
   - **Git way:**
     ```bash
     cd study-desk
     git init
     git add .
     git commit -m "Study Desk"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/study-desk.git
     git push -u origin main
     ```

---

## Step 4: Deploy on Vercel

1. In Vercel, click **Add New → Project** and **Import** your `study-desk` repo.
2. **Framework Preset:** choose **Other**. Leave the build settings empty.
3. Open **Environment Variables** and add each one below (name on the left, your value on the right):

| Name | Value |
|---|---|
| `SUPABASE_URL` | from 2a |
| `SUPABASE_ANON_KEY` | from 2a |
| `SUPABASE_SERVICE_ROLE_KEY` | from 2a (secret) |
| `GEMINI_API_KEY` | from 2b (secret) |
| `GEMINI_MODEL` | from 2b |
| `GROQ_API_KEY` | from 2c, or leave it out |
| `GROQ_MODEL` | `llama-3.3-70b-versatile`, or leave it out |
| `VAPID_PUBLIC_KEY` | from 2d |
| `VAPID_PRIVATE_KEY` | from 2d (secret) |
| `VAPID_SUBJECT` | `mailto:you@gmail.com` |
| `DAILY_AI_LIMIT` | `120` (AI requests per person per day) |

4. Click **Deploy**. After about a minute you get a link like `https://study-desk-abc.vercel.app`. **This is your app.**
5. Back in Supabase, open **Authentication → URL Configuration**, set **Site URL** to your Vercel link, and save. This makes password-reset links work.

**Test it:** open the link, create an account, and fill in your profile. Your first picks should appear in 20 to 40 seconds.

> If you change an environment variable later, go to Vercel → your project → **Deployments** → ⋯ → **Redeploy** so the change takes effect.

---

## Step 5: Turn on the daily job (new papers, picks and notifications)

1. On GitHub, open your repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Add these secrets, with the same values as in Vercel:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY` (optional), `GROQ_MODEL` (optional), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
4. Click **Daily study picks → Run workflow** to test it now. After 1 to 3 minutes it should show a green tick.
5. Open the app's **New** tab. You should see today's papers explained simply.

From now on, it runs by itself every day at **7:00 AM India time** (01:30 UTC). GitHub can sometimes start scheduled jobs 5 to 30 minutes late, which is normal.

To change the time, edit the `cron:` line in `.github/workflows/daily.yml`. The site https://crontab.guru helps you write it, and remember that GitHub uses UTC time.

---

## Step 6: Install on your phone and turn on notifications

**Option A: Install from Chrome (1 minute, works well)**

1. Open your Vercel link in **Chrome** on Android.
2. Tap **⋮ → Install app** (or **Add to Home screen**).
3. Open the app from your home screen and go to **Progress → Settings → Turn on notifications**. Tap **Allow**.
4. Tap **Send a test**. A notification should appear.

**Option B: Make a real APK file (to share with friends)**

1. Go to https://www.pwabuilder.com and paste your Vercel link.
2. Wait for the report, then click **Package for stores → Android → Generate package**.
3. Download the zip. Inside it you'll find:
   - an **`.apk`** file, which you can install directly and share
   - an **`.aab`** file, which is only needed for the Google Play Store
   - a **signing key file and its password**. Keep these safe, because you need the same key to publish updates.
   - an **`assetlinks.json`** file
4. Remove the browser address bar inside the APK: create the folder `public/.well-known/`, put `assetlinks.json` inside it, push to GitHub, and wait for Vercel to redeploy.
5. On your phone, open the `.apk`. Android will ask you to allow installing from this source; allow it once, then install.

Notifications work inside the APK too. Turn them on from **Progress → Settings**.

---

## Sharing with friends

- **Yes, you can share the APK or just your Vercel link.** Each friend creates their own account, and their profile, picks, marks and glossary are private to them. The database security rules make sure no one can see anyone else's data.
- **Everyone shares your free AI quota.** That's why `DAILY_AI_LIMIT` exists. With several active users, add the Groq backup key and consider lowering the limit to around 60.
- **Keep it free and non-commercial.** Vercel's free plan is for personal use, so don't charge people for the app.
- **Never share your secret keys**, even with friends. The secret keys only live in Vercel and GitHub, never inside the app or APK.

---

## Your daily routine

1. **Morning:** tap the notification and read your 6 picks.
2. **Study:** open a pick, read the lesson, ask follow-ups on anything unclear, then tap **Save key terms**.
3. **Test:** tap **Test me**. Under 60% puts it in "Needs another look" on your home screen.
4. **Evening:** check the **New** tab for papers in your focus areas, and tap **Teach me this** on anything important.
5. **Weekly:** look at **Progress → By area** and add your lowest area to your focus areas in your profile.

---

## Fixing common problems

| What you see | What to do |
|---|---|
| "Setup isn't finished" | `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing in Vercel. Add it, then redeploy. |
| "Couldn't load your data" | You didn't run `supabase/schema.sql`. Run it in the Supabase SQL Editor. |
| "No AI key is set on the server" | Add `GEMINI_API_KEY` in Vercel, then redeploy. |
| "The AI service had a problem" | Usually a wrong `GEMINI_MODEL` name. Copy the exact name from AI Studio. You can also check Vercel → project → **Logs**. |
| "The free AI quota is busy" | You hit Gemini's per-minute limit. Wait a minute, or add the Groq backup key. |
| Sign-up never finishes | Turn off **Confirm email** in Supabase (Step 2a, point 5). |
| The New tab is empty | Run the GitHub Action by hand (Step 5.4) and read its log for errors. Check the GitHub secrets are spelled exactly right. |
| No notifications | Check you tapped **Allow**. On your phone, Settings → Apps → Chrome (or Study Desk) → Notifications must be on. Also turn off battery optimization for the app. |
| App "paused" or very slow after a long break | Supabase paused it. Open supabase.com and click **Restore project**. The daily job prevents this while it's running. |
| GitHub Action stopped running | GitHub can turn off scheduled jobs after a long time with no repo activity. Open **Actions** and click **Enable workflow**. |

---

## Changing things later

- **AI model:** change `GEMINI_MODEL` in both Vercel and GitHub secrets.
- **Daily time:** edit the `cron:` line in `.github/workflows/daily.yml`.
- **How many new papers a day:** add a GitHub secret named `MAX_NEW_PAPERS`, and add `MAX_NEW_PAPERS: ${{ secrets.MAX_NEW_PAPERS }}` under `env:` in the workflow file. The default is 12.
- **Prompts** (how lessons, tests and picks are written): `lib/prompts.js`.
- **Look and feel:** `public/styles.css`.

## Project files

```
api/ai.js            AI endpoint: picks, paths, lessons, tests, terms, follow-up chat
api/config.js        Sends public settings to the app
api/push-test.js     Sends a test notification
lib/llm.js           Gemini + Groq backup, with streaming
lib/prompts.js       Every prompt the app uses
lib/push.js          Sends phone notifications
lib/server.js        Login check and database access for the server
scripts/daily.mjs    The daily job: new papers, personal picks, notifications
supabase/schema.sql  Database tables and security rules
public/              The app itself (HTML, CSS, JS, service worker, icons)
.github/workflows/   Runs the daily job at 7 AM
```
