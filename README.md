# 🍺 Sör

A shared PWA for a friend group: log and rate beers & spirits, track drinks at parties, review pubs, compete on a leaderboard, and gamble your points away in a casino. No login — identity is a random ID per device.

Live app: https://beer-dca5c.web.app

## Tabs

| Tab | What it's for |
|---|---|
| 📝 Reviews | Beers + Spirits sub-tabs — add/rate/review either |
| 🍻 Parties | Track beers & shots drunk per person, redeem chips |
| 🍸 Pubs | Rate pubs, tag them by activity (foosball, darts...) |
| 🏆 Rank | Yearly leaderboard — beers, shots, or combined |
| 🎰 Casino | Spend coins earned from ranking on slots + a shop |

## Reviews (Beers & Spirits)

- **Beer**: name, brewery, country + flag, type, filtered toggle, Degree (auto-estimates ALC% via `(degree−1)×0.4`), price, comment, photos
- **Spirit**: name, distillery, type (Vodka/Pálinka/Whiskey/...), ALC%, price, country + flag, comment, photos — no degree/filtered field
- Both: 1–10 rating averaged across everyone (shown with rater count), one review/rating per person, only the creator (or admin) can edit/delete, search + sort + type filter + count badge, tap a card for a read-only view with a photo lightbox

## Parties

- Join a party to get a beer counter and a shot counter (independent `+`/`-`, self or admin only)
- **Chips**: buy a "Free Beer" or "Free Shot" chip in the casino shop, then redeem it — upload a photo, spin a wheel to pick who gave it to you (with an Accept/Respin choice), pick which party it's for, then redeem. One beer chip + one shot chip max per person per party
- Party list/view shows everyone's redeemed chips with their photo; totals show joined count + beer total + shot total

## Pubs

- Name, city, photos, 1–10 rating, unlimited comments per person
- Tag with any combination of: ⚽ Csocsó, 🎱 Billiárd, 🎯 Darts, 🎳 Bowling, 🥊 Box-gép, 🎰 Automat — filterable, color-coded
- Anyone can add photos; only the creator/admin can rename, retag, or delete

## Leaderboard

- Three views: Beer / Shots / All, each a "🍺+🍻 ranked" list for the current year
- A user's total = manual `+`/`-` taps on the board **plus** their live party counts, kept as separate data sources so one can never overwrite the other
- Year rolls over automatically into a frozen, read-only archive the first time anyone opens the app afterward

## Profiles & Badges

- Per-device profile: photo, name, and a badge earned from a total score (beers + spirits + parties + pubs created + parties joined + ratings + reviews)
- Optional decorative poker card + Hungarian card picks
- Roster of every other user, each tappable to view their profile, badges, and equipped casino cosmetics

## Casino

- Everyone starts with coins; earn more by climbing the leaderboard
- A dropdown at the top of the Game tab picks which game to play; every game shares the same coin balance and the same Leaderboard/Shop tabs
- **Jackpot**: slot machine with a paytable, adjustable max bet, and a coin leaderboard — always open
- **Blackjack**: standard Hit/Stand rules (dealer stands on 17, blackjack pays 3:2), persists an in-progress hand so a refresh doesn't strand a paid bet
- New games launch closed by default — hidden from the dropdown for everyone except admin, who can test them freely and flip a per-game Open/Close switch when ready
- **Shop**: Borders, Hats, Skins (profile backgrounds), and Beer/Shot chips — equip one of each category; admin can edit any item's price live
- Skins stay readable in any theme (forced white text + shadow over the skin art) everywhere a skin shows: leaderboard rows, profile header, user list

## Admin

Whoever has `isAdmin: true` on their `users/{uid}` doc can, in addition to normal permissions: edit/delete anyone's beer, spirit, party, or pub; edit shop prices; remove any chip from any user's inventory; open/close casino games; edit anyone's coins or real name. `isAdmin` is never client-writable — it's set once, manually, via the Firebase console or Admin SDK, and enforced server-side in `firestore.rules`.

## Identity & access

- Opening the link in a plain browser tab (not installed) is **read-only**: browsing works with zero sign-in and no account is ever created.
- Installing the app (Add to Home Screen / Install app) prompts for the shared group passcode (verified server-side by the `verifyPasscode` Cloud Function, rate-limited), then Firebase Anonymous Auth signs the device in with a real, unforgeable uid. First time on a given device, this also picks up any existing profile from the old `localStorage` uid automatically (`migrateLegacyProfileIfAny` in `index.html`).
- New members set a nickname + photo once (`passcodeVerified` on their `users/{uid}` doc gates everything else); `firestore.rules`/`storage.rules` require that flag — set only by the Cloud Function — for any write.

## Tech

Single static `index.html`, no build step, Firebase compat SDK via CDN:

- **Firestore**: `beers`, `spirits`, `parties` (+ `participants` subcollection with `count`/`shotCount`), `pubs` (+ `ratings`/`comments`), `users` (profile, inventory, equipped cosmetics, chips array, coins, in-progress `blackjackHand`), `drinkLogs`/`shotLogs` (manual leaderboard taps), `leaderboardArchives` (immutable once created), `config/jackpot` (max bet, shop price overrides), `config/games` (per-game open/closed flags), `passcodeAttempts` (server-only rate-limit bookkeeping)
- **Storage**: photos under `{collection}/{id}/{timestamp}_{filename}`
- **Functions**: `verifyPasscode` (callable, rate-limited, sets `passcodeVerified`), `onTttInviteCreated` (push notification on invite)
- **Hosting** serves the static files; installable as a PWA (`manifest.json`, `sw.js`)
- Back button navigates screen-to-screen via a `pushOverlayState()`/`popstate` history stack instead of exiting the app

## Local development

Open `index.html` directly in a browser, or `firebase serve`.

## Deploying

```bash
firebase deploy
```

Deploys Hosting + `firestore.rules` + `storage.rules`. Requires `firebase login` with the CLI pointed at `beer-dca5c` (default in `.firebaserc`).

## Fresh project setup

1. Create a Firebase project, enable Firestore + Storage (Blaze plan)
2. Register a Web app, copy its `firebaseConfig`
3. Paste into the `firebaseConfig` block in `index.html`
4. Update `.firebaserc` with your project ID
5. `firebase deploy`
