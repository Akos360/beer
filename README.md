# 🍺 Sör

A shared PWA for a friend group: log and rate beers, spirits, cigarettes/vapes ("Nikotin") and energy drinks ("Koffein"), track drinks at parties, review pubs on a real map, compete on a leaderboard, get a Spotify-Wrapped-style yearly recap, and gamble your points away in a casino.

Live app: https://beer-dca5c.web.app

## Layout

Header (always visible): 🎰 Jackpot shortcut · 🎮 Games (Flappy Bird / Tic Tac Toe) · profile avatar.

| Tab | What it's for |
|---|---|
| 📝 Reviews | Sörök / Alko / Nikotin / Koffein sub-tabs — add, rate, review |
| 🍻 Ork akciók (Parties) | Track beers & shots drunk per person, redeem chips, mark a designated driver |
| 🍸 Kocsmák (Pubs) | Rate pubs, tag by activity, see them all on a real map |
| 🏆 Rank | Yearly leaderboard — beers, shots, or combined |

## Reviews (Beers, Spirits, Nikotin, Koffein)

- **Beer**: name, brewery, country + flag, type, filtered toggle, Degree (auto-estimates ALC% via `(degree−1)×0.4`), price, comment, photos/videos
- **Spirit**: name, distillery, type (Vodka/Pálinka/Whiskey/...), ALC%, price, country + flag, comment, photos/videos
- **Nikotin**: type (Cigi/Vape/...), strength, flavor, price, comment, photos/videos
- **Koffein**: type (Energeťák/...), caffeine content, flavor, zero-sugar toggle, price, comment, photos/videos
- All four: 1–10 rating averaged across everyone (rater count shown), one rating/review per person, only the creator (or admin) can edit/delete, search + sort + type filter + count badge, tap a card for a read-only view with a photo/video lightbox (pinch-zoom, swipe or arrow navigation)
- **Variant lookup**: while adding a beer/spirit/nikotin/koffein, an AI lookup (Gemini, via the `lookupVariants` Cloud Function) suggests known real variants of whatever you're typing so you don't have to remember exact names — rate-limited per person per day

## Parties

- Join a party to get a beer counter and a shot counter
- Tapping a counter's ▾ opens a searchable picker of every reviewed beer/spirit so drinks can be logged by exact type, not just a raw total — a plain "Sör"/"Alko" option covers "didn't check what it was"; whatever you just added floats to the top next time
- **🚗 Driver chips**: a button below each drinker's avatar marks them the designated driver for that party (self or admin, one per person per party) and grants a free, non-buyable blue chip. Collect 3 and exchange them in your profile for a free Beer or Shot chip — the 3 spent turn grey but stay visible
- **Chips**: buy a "Free Beer" or "Free Shot" chip in the casino shop, then redeem it — upload a photo, spin a wheel to pick who gave it to you, pick which party it's for, then redeem
- Party view shows a photo/video carousel, everyone's redeemed chips with their photo, and joined/beer-total/shot-total counts

## Pubs

- Name, city, photos/videos, 1–10 rating, unlimited comments per person
- Tag with any combination of: ⚽ Csocsó, 🎱 Billiárd, 🎯 Darts, 🎳 Bowling, 🥊 Box-gép, 🎰 Automat — filterable, color-coded
- **Map**: every located pub shows as a pin on a real OpenStreetMap map (Leaflet + Nominatim, no API key needed). Adding/editing a pub's location searches by name, scoped to a separately-typed city (with a diacritic-tolerant retry) so the right result comes up instead of a same-named venue elsewhere — falls back to dropping a pin manually if nothing matches. A pub's own preview has a 🗺️ button that jumps straight to its pin on the map; admins additionally get a "pubs without a location" list to place one by hand
- Anyone can add photos/videos; only the creator/admin can rename, retag, or delete

## Leaderboard

- Three views: Beer / Shots / All, each ranked for a chosen year (defaults to the current year, past years collapsed)
- A user's total = manual taps on the board **plus** their live party counts; the same per-type breakdown picker used on parties works here too, aggregating both sources into one exact-type view
- A year closes automatically at New Year (`autoCloseYear`, scheduled) into a frozen snapshot; admin has a manual re-close escape hatch (`closeYear`) if the schedule ever misfires

## Year in Review ("Wrapped")

- Every profile has a Spotify-Wrapped-style yearly recap card: total beers/shots drunk (with a top-3 breakdown by exact type), parties joined, chips redeemed, reviews written, ratings given, items added, and that year's top-rated find
- A different fiery color theme per year, downloadable as an image
- The current year shows a live, still-updating preview; past years show the real frozen snapshot

## Profile & Inventory

- Photo, name, a badge earned from a total activity score, optional decorative poker card
- **Inventory** is a collapsible dropdown (closed by default) with Hats / Borders / Skins in their own labeled rows — equip one of each
- **Alko Chips** (buyable Free Beer/Shot) and **Driver Chips** (earned, see Parties) each get their own always-visible row outside the dropdown
- Roster of every other user, sorted by join date (you last, as admin), each tappable to view their profile
- 📬 Mail button opens a shared announcements + ideas board (anyone can post, admin can delete)

## Casino

- Everyone starts with coins; earn more by climbing the leaderboard
- A dropdown at the top of the Jackpot page picks which game to play; every game shares the same coin balance and the same Leaderboard/Shop tabs
- **Jackpot**: slot machine with a paytable, adjustable max bet, and a coin leaderboard — always open
- **Blackjack**: standard Hit/Stand rules (dealer stands on 17, blackjack pays 3:2), persists an in-progress hand across a refresh
- **Roulette** and **Plinko**: full gameplay, admin-gated open/close per game like every non-Jackpot game
- **Shop**: Borders, Hats, Skins (profile backgrounds), and Free Beer/Shot chips — equip one of each category; admin can edit any item's price live

## Games

- Separate from the casino (🎮 header button): **Flappy Mog Rider** (Flappy Bird-style) and **Kő bam bi** (Tic Tac Toe, with invite-a-friend + push notification on invite), each with their own best-score leaderboard

## Notifications

- Web Push (VAPID), opt-in per device, for Tic Tac Toe invites and new announcements/ideas
- Service worker (`sw.js`) shows a proper monochrome status-bar badge (Android masks `badge` to its alpha channel — a full-color image there renders as a garbled blob) and sends with `urgency: high` for faster delivery

## Admin

Whoever has `isAdmin: true` on their `users/{uid}` doc can, in addition to normal permissions: edit/delete anyone's beer/spirit/nikotin/koffein/party/pub; edit shop prices; remove any chip from any user's inventory; open/close casino games; edit anyone's coins or real name; manually re-close a leaderboard year; place a pub's location. `isAdmin` is never client-writable — it's set once, manually, via the Firebase console or Admin SDK, and enforced server-side in `firestore.rules`.

## Identity & access

- Opening the link in a plain browser tab (not installed) is **read-only**: browsing works with zero sign-in and no account is ever created.
- Installing the app (Add to Home Screen / Install app) prompts for the shared group passcode (verified server-side by the `verifyPasscode` Cloud Function, rate-limited both per-device and group-wide), then Firebase Anonymous Auth signs the device in with a real, unforgeable uid.
- New members set a nickname + photo once (`passcodeVerified` on their `users/{uid}` doc gates everything else); `firestore.rules`/`storage.rules` require that flag — set only by the Cloud Function — for any write. A device that previously had a pre-passcode profile gets it folded into the new real uid automatically (`mergeAccountData`).

## Tech

Single static `index.html`, no build step, Firebase compat SDK via CDN, Leaflet.js + OpenStreetMap for the pub map, html2canvas for the Wrapped-card download:

- **Firestore**: `beers`, `spirits`, `nikotin`, `koffein`, `parties` (+ `participants` subcollection — `count`/`shotCount`, `beerBreakdown`/`shotBreakdown`, `isDriver`), `pubs` (+ `ratings`/`comments`, `lat`/`lng`), `users` (profile, inventory, equipped cosmetics, `chips` array incl. driver chips, coins, game stats), `drinkLogs`/`shotLogs` (manual leaderboard taps, per-type breakdown), `yearlyRecaps/{year}/users/{uid}` (frozen Wrapped snapshots), `tttInvites`/`tttGames`, `announcements`/`ideas`, `config` (jackpot max bet, shop price overrides, per-game open/closed), `push_subscriptions`, `passcodeAttempts`/`lookupAttempts` (server-only rate-limit bookkeeping)
- **Storage**: photos/videos under `{collection}/{id}/{timestamp}_{filename}`, capped at 40MB for media
- **Functions**: `verifyPasscode` (callable, rate-limited), `mergeAccountData` (legacy-uid migration), `lookupVariants` (Gemini-backed variant suggestions, rate-limited), `closeYear`/`autoCloseYear` (Wrapped snapshot, scheduled + manual), `onTttInviteCreated`/`onAnnouncementCreated`/`onIdeaCreated`/`on{Beer,Spirit,Nikotin,Koffein,Party,Pub}Created` (push notifications)
- **Hosting** serves the static files; installable as a PWA (`manifest.json`, `sw.js`)
- Back button navigates screen-to-screen via a `pushOverlayState()`/`popstate` history stack instead of exiting the app

## Local development

Open `index.html` directly in a browser, or `firebase serve`.

## Deploying

```bash
firebase deploy
```

Deploys Hosting + `firestore.rules` + `storage.rules` + Functions. Requires `firebase login` with the CLI pointed at `beer-dca5c` (default in `.firebaserc`). Deploy a subset with `--only`, e.g. `firebase deploy --only hosting` or `firebase deploy --only functions:closeYear`.

## Fresh project setup

1. Create a Firebase project, enable Firestore + Storage (Blaze plan — Functions require it)
2. Register a Web app, copy its `firebaseConfig`
3. Paste into the `firebaseConfig` block in `index.html`
4. Update `.firebaserc` with your project ID
5. Set secrets the Functions need: `firebase functions:secrets:set GROUP_PASSCODE`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (web-push keypair), `GEMINI_API_KEY`
6. `firebase deploy`
