# 🍺 Sör

A shared list where friends log and rate beers they've tried — add a beer with photos, rate it, and browse/sort/filter the group's collection.

Live app: https://beer-dca5c.web.app

## Features

- Add a beer with: name, brewery, country + an editable flag emoji, beer type, ALC %, rating (1–10 buttons, color-coded), tasting comment, and one or more photos
- Tap a card to open a read-only view: swipeable photo carousel, all stats, and an Edit button — nothing is editable until you tap Edit
- Tap a photo to open it full-screen (pinch/zoom-friendly lightbox)
- Editing lets you add/remove photos and delete the beer entirely (delete also removes its photos from Storage)
- Inline toolbar (no popups): search on its own row, sort (New→Old / Old→New / Name A–Z / Rating high→low / Rating low→high) and type filter below it, both stretched to fill the width
- Tap the flag emoji directly on a card to edit it in place — its current value is auto-selected so picking a new emoji replaces it instead of appending
- Installable as a PWA (Add to Home Screen), using `img/logo.png` as the app icon
- Light/dark theme toggle

## Tech

Single-page static app (`index.html`) — no build step, no framework. Firebase is loaded via CDN using the compat SDK:
- **Firestore** — one `beers` collection; each document holds all fields (`name`, `brewery`, `country`, `flag`, `beerType`, `abv`, `rating`, `comment`, `ts`) plus a `photos` array (`{url, path, ts}`)
- **Storage** — photos stored under `beers/{beerId}/{timestamp}_{filename}`
- **Hosting** — serves the static files directly
- `manifest.json` + `sw.js` + the `apple-mobile-web-app-*` meta tags in `index.html` make it installable as a standalone app on both Android (Chrome) and iOS (Safari only — Chrome on iOS can't install standalone PWAs, that's an Apple platform restriction)

Same architecture as the `baba` app in this repo, adapted for beer's data model.

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
