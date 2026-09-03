# Kindred Chat

A real-time, multi-user chat web app — vanilla HTML/CSS/JS frontend, [Supabase](https://supabase.com) (Postgres + Auth + Realtime + Storage) backend. No build step, no traditional server.

Features: registration & login, profiles with avatars, user search, 1:1 conversations, real-time messages, typing indicators, online/last-seen presence, seen/read receipts, unread counts, image messages, message reactions, edit & delete, pin & mute conversations, in-conversation message search, light/dark theme, custom accent color, toasts, and graceful loading/empty/error states.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **Sign in** → **New project**.
2. Pick an organization, name the project (e.g. `kindred-chat`), set a database password (save it somewhere safe), choose a region, and click **Create new project**. Wait ~2 minutes for provisioning.

## 2. Create the database

1. In your Supabase project, open the left sidebar → **SQL Editor**.
2. Click **New query**.
3. Open `supabase-schema.sql` from this project, copy its **entire contents**, and paste it into the editor.
4. Click **Run** (bottom right). You should see "Success. No rows returned."

This single script creates every table, index, trigger, function, RLS policy, the storage bucket, and enables Realtime — nothing else is required.

## 3. Storage bucket

The SQL script already creates a public bucket called **chat-media** with the correct upload/read/delete policies. Nothing to configure manually — but to double check: sidebar → **Storage**, and you should see `chat-media` listed as a bucket.

## 4. Configure Authentication

1. Sidebar → **Authentication** → **Providers** → make sure **Email** is enabled (it is by default).
2. Sidebar → **Authentication** → **Sign In / Providers** → for quick local testing, you can disable **"Confirm email"** under **Email** settings so new accounts can log in immediately without clicking a confirmation link. (Leave it on for a real deployment.)
3. Sidebar → **Authentication** → **URL Configuration** → set **Site URL** to wherever you'll host the app (e.g. `http://localhost:8080` while testing, your Vercel/Netlify URL once deployed). This is used for password-reset email links.

## 5. Get your Supabase URL

Sidebar → **Settings** (gear icon) → **API**. Copy the **Project URL** (looks like `https://xxxxxxxxxxx.supabase.co`).

## 6. Get your anon/public key

Same page (**Settings → API**) → copy the key labeled **anon / public**. This is safe to use in frontend code — it is restricted by the Row Level Security policies created in step 2.

**Never** copy the `service_role` key into this project. That key bypasses all security rules and must never appear in frontend code.

## 7. Configure `config.js`

Open `config.js` in this project and replace the two placeholder values:

```javascript
const SUPABASE_URL = "YOUR_SUPABASE_URL";       // paste your Project URL
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // paste your anon public key
```

Save the file.

## 8. Run locally

Opening `index.html` directly with `file://` will break Supabase's auth redirects and some browser APIs, so serve it over `http://localhost` instead. Easiest options:

**Python (already installed on most systems):**
```bash
cd chat-app
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

**Node (if you have it):**
```bash
cd chat-app
npx serve .
```

**VS Code:** install the "Live Server" extension, right-click `index.html` → **Open with Live Server**.

## 9. Deploy to Vercel

1. Push this folder to a GitHub repo (or use the Vercel CLI directly).
2. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import your repo.
3. Framework preset: **Other** (no build step needed). Leave build/output settings blank.
4. Click **Deploy**.
5. Once deployed, go back to Supabase → **Authentication → URL Configuration** and update **Site URL** to your new `https://your-app.vercel.app` URL.

*(CLI alternative: `npm i -g vercel`, then `cd chat-app && vercel`.)*

## 10. Deploy to Netlify

1. Push this folder to a GitHub repo.
2. Go to [netlify.com](https://netlify.com) → **Add new site → Import an existing project** → connect your repo.
3. Build command: leave blank. Publish directory: `/` (the repo root, since `index.html` lives there).
4. Click **Deploy site**.
5. Update Supabase's **Site URL** to your new `https://your-app.netlify.app` URL, same as step 9.5.

*(Drag-and-drop alternative: Netlify dashboard → **Add new site → Deploy manually** → drag the `chat-app` folder in.)*

---

## Testing with two accounts

Real-time features need two separate logged-in sessions to verify.

**Create two test accounts:**
- User A: `alice@example.com` / any password 6+ characters / username `alice`
- User B: `bob@example.com` / any password 6+ characters / username `bob`

**Test flow:**

1. Register User A in your main browser window.
2. Open a second **incognito/private window** (or a different browser).
3. Register User B in that window.
4. Back in User A's window: type "bob" into the search box, click the result to open a conversation.
5. Send a message as User A.
6. Switch to User B's window — the message should appear **without refreshing**, and User A's conversation preview should update instantly.
7. Reply as User B.
8. Switch back to User A — the reply arrives in real time, and a typing indicator should briefly appear while User B is composing.
9. Try reactions, editing, deleting, image upload, pin/mute, and read receipts (the ✓✓ on User A's sent message should turn active once User B opens the conversation) between the two windows.

---

## Project structure

```text
chat-app/
├── index.html          # markup for auth screens + chat shell + modals
├── style.css            # all styling, light/dark themes, responsive rules
├── script.js             # all application logic (auth, realtime, UI)
├── config.js              # YOUR Supabase URL + anon key go here
├── supabase-schema.sql     # paste into Supabase SQL Editor — run once
├── README.md
└── assets/
    └── default-avatar.svg
```

## Security notes

- Row Level Security is enabled on every table. Users can only read conversations/messages they're a member of, and can only modify their own profile, messages, reactions, and conversation settings — all enforced at the database level, not just in the frontend.
- Only the anon/public key is ever used client-side. It has no special privileges beyond what RLS policies allow.
- Storage uploads are scoped per-user by folder path (`<user_id>/...`) so users can only write into their own folder, while all chat media is publicly readable (needed to display images in the UI).

## Known limitations

- Presence ("online") relies on Supabase's Realtime Presence feature plus browser `visibilitychange`/`pagehide` events. Browsers cannot guarantee a clean disconnect signal (e.g. a crashed tab or lost network won't fire these events), so "last seen" is the honest fallback rather than instant offline detection in every case.
- 1:1 conversations only (no group chats) to keep the schema and UI scope manageable — the `conversation_members` table is already shaped to support groups if you want to extend it later.
- Message history loads the most recent 200 messages per conversation; older messages aren't paginated in this version.
