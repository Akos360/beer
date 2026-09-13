# 🍺 Sör

A shared list where friends log and rate beers they've tried — add a beer with photos, rate it, and browse/sort/filter the group's collection.

Live app: https://beer-dca5c.web.app

## Features

- Add a beer with: name, brewery, country + an editable flag emoji, beer type, Filtered/unfiltered switch, Degree (°) + ALC %, price (€), tasting comment, and one or more photos. Typing a Degree (common on Czech/Slovak labels, e.g. "Svijany 11°") auto-fills an estimated ALC % using the rule of thumb `(degree − 1) × 0.4` — actual attenuation varies per beer, so it's a starting point you can correct to match the label
- Typing a name that matches an existing beer (case-insensitive) shows a non-blocking "already exists" warning under the Name field — a nudge, not a hard stop, since two entries can legitimately share a name
- **Only the beer's creator can Edit or delete it** (tracked via a `createdBy` device ID set on creation). Beers from before this feature had no creator recorded, so they stay editable by anyone rather than getting stranded. One device ID is hardcoded as `ADMIN_UID` in `index.html` and can Edit/delete any beer regardless of who created it
- **Ratings are per-user and averaged**: everyone who opens a beer (in the read-only view, no need to edit) can tap 1–10 to set or change their own rating; the badge shown everywhere (card, view, sorting) is the live average across everyone who's rated it, with the number of raters in parentheses
- **Reviews**: below your own rating, a text box lets you post a review, paired with the rating you just gave. Below that, a scrollable "Reviews" list shows everyone's review — their photo, name, comment, and star rating — updating live as people post
- Tap a card to open a read-only view: swipeable photo carousel, stats, your own rating + review, everyone else's reviews, and (creator only) an Edit button — nothing else is editable until you tap Edit
- Tap a photo to open it full-screen (pinch/zoom-friendly lightbox)
- Editing lets you add/remove photos and delete the beer entirely (delete also removes its photos and ratings/reviews from Storage/Firestore)
- Inline toolbar (no popups): search on its own row, sort (New→Old / Old→New / Name A–Z / Rating high→low / Rating low→high) and type filter below it, both stretched to fill the width
- Tap the flag emoji directly on a card to edit it in place — its current value is auto-selected so picking a new emoji replaces it instead of appending
- **The Android/hardware back button navigates within the app instead of exiting it**: each opened screen (beer view, edit form, lightbox, profile view, edit profile, delete confirmation) pushes a browser history entry via `pushOverlayState()`, and a single `popstate` listener closes whichever screen is currently on top — restoring its parent screen (e.g. Edit → the beer's View, Edit Profile → the roster, someone else's profile → your own) rather than dropping straight to Home. Only backing out of every open screen actually exits the app
- **Profiles, per device, no login**: tapping the avatar button (top-right, next to the theme toggle) opens a read-only view of your own photo, name, and **earned** badge, plus a roster of every other device/user that's set up a profile — tap any of them to see that person's photo/name/badge full-size. An Edit button on your own profile opens the actual editable form (photo upload, name) — badges can't be picked, only earned. That same Edit screen shows the full badge ladder (Rookie → Liability) with the point threshold for each tier and your current one highlighted. Your rank is a combined total of beers you've uploaded + parties you've created + pubs you've created + parties you've joined + ratings you've given + reviews/comments you've written — the same breakdown (beers · parties · pubs · joined · ratings · reviews) shows on your own profile, everyone else's, and the roster. Rating a pub and rating a beer both land in the same "ratings" count, and writing a pub comment lands in "reviews" alongside beer reviews, since a `collectionGroup('ratings')` query naturally spans both beers' and pubs' `ratings` subcollections (they share the same subcollection name) — only pub comments needed a dedicated `collectionGroup('comments')` listener, since beer reviews live inside the rating doc itself rather than a separate subcollection. Identity is just a random ID generated on first visit and stored in that browser's `localStorage` — nothing to sign in with, and it's tied to the device/browser, not a person
- Installable as a PWA (Add to Home Screen), using `img/logo.png` as the app icon
- Light/dark theme toggle
- **Parties, for counting beers at an event**: a 2×2 "🍺 Beers / 🍻 Parties / 🍸 Pubs / 🏆 Rank" tab switch above the search bar swaps the whole home screen — Parties mode drops the search/filter row entirely and shows a single-column list (one photo + name + "X joined · Y beers" per row, plus a date and year as two small stacked tags on the right when set — separate fields, e.g. date `9/15` and year `2026`, not a native date picker); the `+` button becomes "Add Party" while this tab is active. A party has a name, that optional date/year, and photos, editable only by whoever created it (or the admin). Opening a party shows everyone in the app: people who've tapped **Join** get a beer counter with `+`/`-` only they (or the admin) can tap; everyone else just shows "Not joined" (or a **Join** button on their own row). Counts are summed live into the "X joined · Y beers" line on the list
- **Pubs ("🍸 Pubs" tab)**: same single-column list style as Parties, but a pub is a name, an optional city (shown as a bordered tag on the right of its list row and under its name in the view screen), photos, a 1–10 rating (averaged across everyone, exactly like beer ratings), and a comment thread. Unlike everything else in the app, **anyone can add more photos** to a pub directly from its view screen — only the pub's creator (or the admin) can rename it, set its city, manage/remove its photos, or delete it. Comments aren't capped at one per person like beer reviews — the same person can post as many as they want, each one still showing their *current* rating alongside it since rating and commenting are tracked separately (a `ratings` subcollection plus a `comments` subcollection, instead of the combined rating+comment doc beers use)
- **Leaderboard ("🏆 Rank" tab)**: ranks everyone by total beers drunk this year, combining every party tap with beers logged outside of any party (a `+`/`-` right on the leaderboard row, same self-only-or-admin rule as parties; the `-` shows whenever that person's total is above zero, not just for same-day corrections). A party's beers are attributed to the date the party was created, so a whole party still only ever counts as one day, however many people tapped `+` during it. Every party is backfilled into the leaderboard exactly once (a `backfilled` flag on the party doc makes this idempotent — safe even if it re-checks on every load) so pre-existing party totals from before this feature shipped are included, not just future taps. At year end, whoever next opens the app triggers an automatic once-only snapshot of the previous year's final standings into an immutable archive (Firestore rules physically block updates/deletes on it once created) — the live board then naturally starts back at zero since it only sums the current year's data. Past years show up in a "Past Years" list below the live board, tap one for a frozen, read-only view

## Tech

Single-page static app (`index.html`) — no build step, no framework. Firebase is loaded via CDN using the compat SDK:
- **Firestore** — a `beers` collection (`name`, `brewery`, `country`, `flag`, `beerType`, `filtered`, `abv`, `price`, `comment`, `ts`, `createdBy`, computed `avgRating`/`ratingCount`, plus a `photos` array of `{url, path, ts}`), each with a `ratings` subcollection (doc id = rater's uid, `{rating, comment, userId, ts}` — a "rating" and a "review" are the same document) that `avgRating`/`ratingCount` are recomputed from on every rating change, and a `users` collection, doc id = a random UUID generated client-side and stored in `localStorage` (`name`, `photoURL`, `photoPath`). Badges are never stored — they're computed client-side from a live `collectionGroup('ratings')` listener plus the beers list, matched against the `TIERS` thresholds in `index.html`
- Firestore rules include `match /{path=**}/ratings/{userId}` and `match /{path=**}/participants/{userId}` wildcard rules specifically to authorize those collection-group reads — the nested per-document rules alone don't cover cross-collection queries
- A `parties` collection (`name`, `createdBy`, `ts`, `photos`) each with a `participants` subcollection (doc id = joined user's uid, `{count, ts}` — the doc only exists once that person has tapped Join, and `count` goes up only via `FieldValue.increment(1)`, never manual entry)
- A `drinkLogs` collection, doc id `{userId}_{YYYY-MM-DD}` (`userId`, `date`, `year`, `count`) — every party +/- tap and every standalone leaderboard +/- writes here too, so it's the single source of truth the leaderboard sums from, split out by day. A `leaderboardArchives/{year}` doc is created once (client-side, opportunistically, the next time anyone opens the app after the year rolls over) by aggregating that year's `drinkLogs`; Firestore rules allow `create` but hard-deny `update`/`delete` on it, so once written a year's standings can never be changed — confirmed by testing that even a direct client delete attempt is rejected
- **Storage** — beer photos under `beers/{beerId}/{timestamp}_{filename}`, profile photos under `users/{userId}/{timestamp}_{filename}`, party photos under `parties/{partyId}/{timestamp}_{filename}`
- **Hosting** — serves the static files directly
- `manifest.json` + `sw.js` + the `apple-mobile-web-app-*` meta tags in `index.html` make it installable as a standalone app on both Android (Chrome) and iOS (Safari only — Chrome on iOS can't install standalone PWAs, that's an Apple platform restriction)

Same architecture as the `baba` app in this repo, adapted for beer's data model. Note: there's no real authentication anywhere in the app (device IDs are just self-reported `localStorage` values), so "only the creator can edit" is a UI-level restriction, not a cryptographically enforced one — consistent with the fully open trust model the rest of the app already relies on for a small friends group.

## Local development

Just open `index.html` in a browser — it talks directly to Firebase, no local server required (though `firebase serve` works too).

## Deploying

```bash
firebase deploy
```

Deploys Hosting plus `firestore.rules` and `storage.rules`. Requires `firebase login` and the CLI pointed at the `beer-dca5c` project (already set as default in `.firebaserc`).

## Firebase project setup (for a fresh clone / new project)

1. Create a Firebase project, enable Firestore and Storage (Storage requires the Blaze plan)
2. Register a Web app in the project settings to get a `firebaseConfig` object
3. Paste those values into the `firebaseConfig` block near the bottom of `index.html`
4. Update `.firebaserc` with your project ID
5. `firebase deploy`
