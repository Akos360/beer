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
- **Jackpot**: slot machine with a paytable, adjustable max bet, and a coin leaderboard
- **Shop**: Borders, Hats, Skins (profile backgrounds), and Beer/Shot chips — equip one of each category; admin can edit any item's price live
- Skins stay readable in any theme (forced white text + shadow over the skin art) everywhere a skin shows: leaderboard rows, profile header, user list

## Admin

One hardcoded device ID (`ADMIN_UID` in `index.html`) can, in addition to normal permissions: edit/delete anyone's beer, spirit, party, or pub; edit shop prices; remove any chip from any user's inventory. All enforcement is client-side — there's no real auth, consistent with the app's open trust model for a small group.

## Tech

Single static `index.html`, no build step, Firebase compat SDK via CDN:

- **Firestore**: `beers`, `spirits`, `parties` (+ `participants` subcollection with `count`/`shotCount`), `pubs` (+ `ratings`/`comments`), `users` (profile, inventory, equipped cosmetics, chips array, coins), `drinkLogs`/`shotLogs` (manual leaderboard taps), `leaderboardArchives` (immutable once created), `config/jackpot` (max bet, shop price overrides)
- **Storage**: photos under `{collection}/{id}/{timestamp}_{filename}`
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
