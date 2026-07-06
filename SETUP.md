# Alcea Inventory — Setup, Deploy & Install

A green/gold PWA (Progressive Web App). Once deployed it installs to the home
screen on **both iOS and Android** with the ALCEA icon and launches full-screen,
no browser bar — same feel as a native app.

## Files in this folder
- `index.html` — the app (must stay named index.html)
- `manifest.webmanifest` — makes it installable, defines name + icons
- `sw.js` — service worker; caches the UI so it launches fast and survives wifi drops
- `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` — Android icons
- `apple-touch-icon.png` — iOS home-screen icon
- `SETUP.md` — this file

Keep all files in the **same folder / repo root**. The paths are relative.

---

## 1. Supabase (one-time, ~5 min) — optional but recommended
Runs local-only with no setup, but for multi-device sync (tablet + phone):

Create a project (Singapore region = nearest to Malaysia), then in **SQL Editor**
run:

```sql
create table items (
  id text primary key, name text not null, unit text not null,
  low int default 5, storage int default 0, prep int default 0,
  used int default 0, waste int default 0, created_at timestamptz default now()
);
create table recipes (
  id text primary key, name text not null,
  ing jsonb not null default '{}', created_at timestamptz default now()
);
-- sales are per DAY per menu item (composite key)
create table sales (
  date date not null,
  recipe_id text not null,
  qty int default 0,
  created_at timestamptz default now(),
  primary key (date, recipe_id)
);
-- movements carry structured item_id + qty for daily reconciliation
create table movements (
  id bigint generated always as identity primary key,
  type text not null,          -- receive | prep | used | waste | adjust
  msg text not null,
  item_id text,
  qty int,
  created_at timestamptz default now()
);
-- single settings row holds the admin PIN
create table settings (
  id int primary key default 1,
  pin text not null default '4337'
);
insert into settings (id, pin) values (1, '4337') on conflict (id) do nothing;

alter publication supabase_realtime add table items;
alter publication supabase_realtime add table movements;
alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table settings;

alter table items enable row level security;
alter table recipes enable row level security;
alter table sales enable row level security;
alter table movements enable row level security;
alter table settings enable row level security;

create policy "open" on items for all using (true) with check (true);
create policy "open" on recipes for all using (true) with check (true);
create policy "open" on sales for all using (true) with check (true);
create policy "open" on movements for all using (true) with check (true);
create policy "open" on settings for all using (true) with check (true);
```

> **Already ran the earlier schema?** Run this migration instead to upgrade
> without losing data:
> ```sql
> alter table movements add column if not exists item_id text;
> alter table movements add column if not exists qty int;
> drop table if exists sales;
> create table sales (
>   date date not null, recipe_id text not null, qty int default 0,
>   created_at timestamptz default now(), primary key (date, recipe_id)
> );
> create table if not exists settings (id int primary key default 1, pin text not null default '4337');
> insert into settings (id, pin) values (1,'4337') on conflict (id) do nothing;
> alter table sales enable row level security;
> alter table settings enable row level security;
> create policy "open" on sales for all using (true) with check (true);
> create policy "open" on settings for all using (true) with check (true);
> alter publication supabase_realtime add table settings;
> ```
> (Dropping `sales` only clears past POS-sales entries, not your stock or
> movement history. Historical daily usage is rebuilt from the movements log.)

Then **Project Settings -> API**, copy the Project URL + anon key into the top of
`index.html`:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
```

No Netlify environment variables are needed — the anon key is public by design
and lives in the client file, same as your other apps.

---

## 2. Deploy (GitHub -> Netlify or Cloudflare Pages)
1. Create a new GitHub repo (web UI) and upload **all files** to the root.
2. In Netlify: **Add new site -> Import from GitHub -> pick the repo**.
   - Build command: leave **blank**
   - Publish directory: leave as root (`.`)
3. Deploy. You get a URL like `alcea-inventory.netlify.app`.

> **HTTPS is required** for PWA install — Netlify and Cloudflare Pages both give
> it automatically, so you're covered.

Every commit auto-deploys, same as ROC.ai and FORGE.

---

## 3. Install on the home screen

### Android (Chrome) — the tablet
1. Open the site URL in Chrome.
2. A **"Install app" / "Add to Home screen"** banner appears — tap it.
   (Or menu ⋮ -> **Install app**.)
3. The ALCEA icon lands on the home screen. Opens full-screen, no address bar.

### iPhone / iPad (Safari)
1. Open the URL in **Safari** (must be Safari, not Chrome, for install on iOS).
2. Tap the **Share** button (square with up-arrow).
3. Scroll down -> **Add to Home Screen** -> **Add**.
4. The ALCEA icon appears; launches full-screen.

---

## Staff mode vs Admin mode
The app opens in **staff mode**: kitchen staff see only the **Stock** tab and the
Receive / Prep / Use / Waste buttons. That's all they need during service — nothing
to accidentally break.

Tap the **lock icon** (top-right) and enter the PIN — **`4337`** — to enter
**admin mode**, which reveals three more tabs:
- **Reconcile** — daily check with a date picker (see below)
- **Recipes** — add / edit / remove menu items
- **Log** — full movement history, grouped by day, including audit entries

In admin mode you can also **tap any count** on an ingredient (Storage / Prep /
Used / Waste) to correct it directly — handy when a physical count doesn't match.
Every correction is written to the log as an `adjust` entry (e.g. *"Egg storage
corrected 10 → 8 (admin)"*) so nothing changes silently.

Admin **auto-locks after 5 minutes idle** or on reload. Change the PIN anytime:
lock icon → **Admin settings → Update PIN** (syncs to all devices).

> The PIN is a soft lock to prevent accidental edits on a shared tablet — not
> hard security (it lives in the shared data). Fine for an internal tool. If you
> ever need real per-user access control, that's Supabase Auth as a later add-on.

## Daily tracking & reconciliation
Stock counts run **continuously** — storage/prep/used/waste carry across days,
because freezers don't empty at midnight. What's now tracked *per day*:

- **Daily usage** — the Reconcile tab shows, for any chosen date, how much of each
  ingredient was received / prepped / used / wasted that day (pulled from the
  timestamped movement log).
- **Daily reconciliation** — pick a date, enter that day's POS sales, and it
  compares the ingredients those sales imply against what was actually logged as
  *used* that same day. Each day gets its own pass/fail verdict, and past days stay
  viewable. The day boundary is local **midnight**.

Because everything is logged live during service, the day's expected-vs-used lines
up in real time.

## Why a PWA and not a real .apk / .ipa?
A true native installable file needs Android Studio / Xcode or a wrapper build
(Capacitor) plus — for iOS — a paid Apple Developer account and sideloading. For
an internal cafe tool on your own devices that's a lot of overhead for zero
benefit. The PWA installs in three taps, updates instantly on every deploy (no
app-store review), and behaves identically for this use case.

If you ever genuinely need a store-listed native app later, the same `index.html`
can be wrapped with Capacitor with no rewrite — this build is already
PWA-structured for that path.

## Notes
- **Icon:** redrawn from your logo as clean line-art. If you have the original
  vector (SVG/AI/PDF), it can be dropped in for a pixel-exact icon.
- **Offline:** the UI shell is cached, so the app opens even with no signal.
  Live counts still need Supabase connectivity to sync between devices.
- **Updating the app:** because the service worker caches the shell, after you
  push a new version users get it on the **second** launch (first launch serves
  cache, then updates in background). Bump `CACHE = 'alcea-inv-v2'` in `sw.js`
  when you want to force an immediate refresh.
