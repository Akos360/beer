# 🍺 Sör

A shared list where friends log and rate beers they've tried — add a beer with photos, rate it, and browse/sort/filter the group's collection.

Live app: https://beer-dca5c.web.app

## Features

- Add a beer with: name, brewery, country + an editable flag emoji, beer type, Filtered/unfiltered switch, Degree (°) + ALC %, price (€), tasting comment, and one or more photos. Typing a Degree (common on Czech/Slovak labels, e.g. "Svijany 11°") auto-fills an estimated ALC % using the rule of thumb `(degree − 1) × 0.4` — actual attenuation varies per beer, so it's a starting point you can correct to match the label
- **Only the beer's creator can Edit or delete it** (tracked via a `createdBy` device ID set on creation). Beers from before this feature had no creator recorded, so they stay editable by anyone rather than getting stranded. One device ID is hardcoded as `ADMIN_UID` in `index.html` and can Edit/delete any beer regardless of who created it
- **Ratings are per-user and averaged**: everyone who opens a beer (in the read-only view, no need to edit) can tap 1–10 to set or change their own rating; the badge shown everywhere (card, view, sorting) is the live average across everyone who's rated it, with the number of raters in parentheses
- **Reviews**: below your own rating, a text box lets you post a review, paired with the rating you just gave. Below that, a scrollable "Reviews" list shows everyone's review — their photo, name, comment, and star rating — updating live as people post
- Tap a card to open a read-only view: swipeable photo carousel, stats, your own rating + review, everyone else's reviews, and (creator only) an Edit button — nothing else is editable until you tap Edit
- Tap a photo to open it full-screen (pinch/zoom-friendly lightbox)
- Editing lets you add/remove photos and delete the beer entirely (delete also removes its photos and ratings/reviews from Storage/Firestore)
- Inline toolbar (no popups): search on its own row, sort (New→Old / Old→New / Name A–Z / Rating high→low / Rating low→high) and type filter below it, both stretched to fill the width
- Tap the flag emoji directly on a card to edit it in place — its current value is auto-selected so picking a new emoji replaces it instead of appending
- **The Android/hardware back button navigates within the app instead of exiting it**: each opened screen (beer view, edit form, lightbox, profile view, edit profile, delete confirmation) pushes a browser history entry via `pushOverlayState()`, and a single `popstate` listener closes whichever screen is currently on top — restoring its parent screen (e.g. Edit → the beer's View, Edit Profile → the roster, someone else's profile → your own) rather than dropping straight to Home. Only backing out of every open screen actually exits the app
- **Profiles, per device, no login**: tapping the avatar button (top-right, next to the theme toggle) opens a read-only view of your own photo, name, and **earned** badge, plus a roster of every other device/user that's set up a profile — tap any of them to see that person's photo/name/badge full-size. An Edit button on your own profile opens the actual editable form (photo upload, name) — badges can't be picked, only earned. That same Edit screen shows the full badge ladder (Rookie → Liability) with the point threshold for each tier and your current one highlighted. Your rank is a combined total of beers you've uploaded + beers you've rated + reviews you've written. Identity is just a random ID generated on first visit and stored in that browser's `localStorage` — nothing to sign in with, and it's tied to the device/browser, not a person
- Installable as a PWA (Add to Home Screen), using `img/logo.png` as the app icon
- Light/dark theme toggle

## Tech

Single-page static app (`index.html`) — no build step, no framework. Firebase is loaded via CDN using the compat SDK:
- **Firestore** — a `beers` collection (`name`, `brewery`, `country`, `flag`, `beerType`, `filtered`, `abv`, `price`, `comment`, `ts`, `createdBy`, computed `avgRating`/`ratingCount`, plus a `photos` array of `{url, path, ts}`), each with a `ratings` subcollection (doc id = rater's uid, `{rating, comment, userId, ts}` — a "rating" and a "review" are the same document) that `avgRating`/`ratingCount` are recomputed from on every rating change, and a `users` collection, doc id = a random UUID generated client-side and stored in `localStorage` (`name`, `photoURL`, `photoPath`). Badges are never stored — they're computed client-side from a live `collectionGroup('ratings')` listener plus the beers list, matched against the `TIERS` thresholds in `index.html`
- Firestore rules include a `match /{path=**}/ratings/{userId}` wildcard rule specifically to authorize that collection-group read — the nested per-beer rule alone doesn't cover cross-collection queries
- **Storage** — beer photos under `beers/{beerId}/{timestamp}_{filename}`, profile photos under `users/{userId}/{timestamp}_{filename}`
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
