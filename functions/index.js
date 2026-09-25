const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const webpush = require('web-push');

initializeApp();

// The one thing that gates real membership: signing in anonymously is free
// for anyone, but writing anything (rating, adding, casino, etc.) requires
// having verified this passcode first. The gate lives as a custom claim on
// the Firebase Auth token (checked directly in firestore.rules/storage.rules
// via request.auth.token.passcodeVerified) rather than a Firestore field,
// since Storage rules can't reliably cross-read Firestore in this project —
// a claim is available to both without an extra lookup. It's mirrored onto
// the users/{uid} doc too, purely for convenience (e.g. the "Admin" tag),
// but that copy is never the security boundary.
// Set with: firebase functions:secrets:set GROUP_PASSCODE
const GROUP_PASSCODE = defineSecret('GROUP_PASSCODE');
const PASSCODE_MAX_ATTEMPTS = 5;
const PASSCODE_WINDOW_MS = 10 * 60 * 1000;
// Per-uid limiting alone doesn't actually stop a scripted guesser, since
// anonymous sign-in is free and unlimited — discard the uid, get a fresh
// 5-attempt budget. This second, shared counter caps the TOTAL wrong
// attempts across every identity in the same window, closing that gap
// without touching the per-uid one (which still gives a normal person who
// mistypes their own passcode a few tries before hitting the group cap).
const PASSCODE_GLOBAL_MAX_ATTEMPTS = 30;

exports.verifyPasscode = onCall({ secrets: [GROUP_PASSCODE] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const submitted = String(request.data?.passcode || '').trim();

  const db = getFirestore();
  const attemptsRef = db.collection('passcodeAttempts').doc(uid);
  const globalRef = db.collection('passcodeAttempts').doc('_global');
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const [snap, globalSnap] = await Promise.all([tx.get(attemptsRef), tx.get(globalRef)]);
    let { count = 0, windowStart = now } = snap.data() || {};
    if (now - windowStart > PASSCODE_WINDOW_MS) { count = 0; windowStart = now; }
    let { count: globalCount = 0, windowStart: globalWindowStart = now } = globalSnap.data() || {};
    if (now - globalWindowStart > PASSCODE_WINDOW_MS) { globalCount = 0; globalWindowStart = now; }
    if (count >= PASSCODE_MAX_ATTEMPTS || globalCount >= PASSCODE_GLOBAL_MAX_ATTEMPTS) {
      return { allowed: false };
    }
    const correct = submitted.length > 0 && submitted === GROUP_PASSCODE.value();
    if (correct) {
      tx.delete(attemptsRef);
    } else {
      tx.set(attemptsRef, { count: count + 1, windowStart }, { merge: true });
      tx.set(globalRef, { count: globalCount + 1, windowStart: globalWindowStart }, { merge: true });
    }
    return { allowed: true, correct };
  });

  if (!result.allowed) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again later.');
  }
  if (!result.correct) {
    throw new HttpsError('permission-denied', 'Wrong passcode.');
  }

  // Only this trusted server code may ever grant this claim — clients
  // can't set custom claims on themselves, so there is no way to grant
  // yourself membership without going through here.
  const existing = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...existing.customClaims, passcodeVerified: true });
  await db.collection('users').doc(uid).set({
    passcodeVerified: true,
    passcodeVerifiedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// The one-time admin-bootstrapping function that used to live here
// (claimAdmin, gated by a separate ADMIN_SETUP_KEY secret) has been removed
// now that the real admin's isAdmin claim is already set — it was a
// standing privilege-escalation surface for as long as it stayed deployed
// (anyone who ever learned that secret could self-promote to admin forever,
// with no other check). If a fresh admin bootstrap is ever needed again,
// the safest path is a short-lived one-off Admin SDK script run locally
// (`getAuth().setCustomUserClaims(uid, { isAdmin: true, passcodeVerified:
// true })`), not a permanently-deployed callable function.

// One-time cleanup for the passcode/anon-auth migration: the automatic
// same-device migration (see migrateLegacyProfileIfAny in index.html) only
// copies fields that live directly on the users/{uid} doc (name, photo,
// coins, badges, inventory, game stats). Content *attributed to* the old
// uid — beers/spirits/parties/pubs someone added, their ratings, pub
// comments, party participation, drink/shot logs — lives on other
// documents keyed or field-tagged by that old uid, and reassigning it
// requires bypassing per-user ownership rules (nobody can sign in as the
// old uid to do it themselves), so it has to run as trusted server code.
// Called automatically by migrateLegacyProfileIfAny() in index.html right
// after a same-device migration copies the users/{uid} doc fields, so
// every real member gets their full history moved in one go — not just
// admin-run cleanup for cases the automatic path already missed.
//
// Self-service (newUid === caller) is allowed, but only when oldUid points
// at a genuine pre-passcode relic (no passcodeVerified on it) — otherwise
// anyone could siphon another real member's contribution history into
// their own account just by naming their uid. An admin can still merge any
// two accounts explicitly, for edge cases the automatic path can't cover.
exports.mergeAccountData = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const isAdminCaller = !!request.auth.token?.isAdmin;
  const oldUid = String(request.data?.oldUid || '');
  const newUid = String(request.data?.newUid || callerUid);
  if (!oldUid || !newUid || oldUid === newUid) {
    throw new HttpsError('invalid-argument', 'Need distinct oldUid and newUid.');
  }
  if (!isAdminCaller && newUid !== callerUid) {
    throw new HttpsError('permission-denied', 'Can only merge into your own account.');
  }

  const db = getFirestore();
  const oldDoc = await db.collection('users').doc(oldUid).get();
  if (!oldDoc.exists) throw new HttpsError('not-found', 'No such account to merge from.');
  if (!isAdminCaller && oldDoc.data().passcodeVerified) {
    throw new HttpsError('permission-denied', 'That account is already a real member — cannot merge from it.');
  }

  const summary = {};

  // createdBy reassignment on top-level content collections.
  for (const col of ['beers', 'spirits', 'parties', 'pubs']) {
    const snap = await db.collection(col).where('createdBy', '==', oldUid).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { createdBy: newUid }));
    if (snap.size) await batch.commit();
    summary[col] = snap.size;
  }

  // Ratings subcollections — doc id IS the uid, so move by copy then delete.
  // (Used to only cover beers/spirits — pubs, nikotin, and koffein ratings
  // were silently left behind on every past migration as a result, which is
  // exactly what produced ~121 "Anonymous" pub ratings found and repaired
  // by hand in September 2026.)
  let ratingsMoved = 0;
  for (const col of ['beers', 'spirits', 'nikotin', 'koffein', 'pubs']) {
    const parents = await db.collection(col).get();
    for (const parent of parents.docs) {
      const oldRef = parent.ref.collection('ratings').doc(oldUid);
      const oldSnap = await oldRef.get();
      if (!oldSnap.exists) continue;
      const newRef = parent.ref.collection('ratings').doc(newUid);
      const newSnap = await newRef.get();
      if (!newSnap.exists) {
        await newRef.set({ ...oldSnap.data(), userId: newUid });
      }
      await oldRef.delete();
      ratingsMoved++;
    }
  }
  summary.ratingsMoved = ratingsMoved;

  // Pub comments — auto-ID docs with a userId field; just repoint the
  // field. Queried per-pub (not via collectionGroup) so this doesn't need
  // a collection-group index that may not exist/be built yet.
  let commentsMoved = 0;
  const pubsForComments = await db.collection('pubs').get();
  for (const pub of pubsForComments.docs) {
    const snap = await pub.ref.collection('comments').where('userId', '==', oldUid).get();
    if (!snap.size) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { userId: newUid }));
    await batch.commit();
    commentsMoved += snap.size;
  }
  summary.commentsMoved = commentsMoved;

  // Party participants — doc id IS the uid; move by copy then delete,
  // summing counts in the unlikely case the new uid already joined too.
  let participantsMoved = 0;
  const parties = await db.collection('parties').get();
  for (const party of parties.docs) {
    const oldRef = party.ref.collection('participants').doc(oldUid);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) continue;
    const newRef = party.ref.collection('participants').doc(newUid);
    const newSnap = await newRef.get();
    if (newSnap.exists) {
      const a = newSnap.data(), b = oldSnap.data();
      await newRef.set({
        count: (a.count || 0) + (b.count || 0),
        shotCount: (a.shotCount || 0) + (b.shotCount || 0),
        ts: Math.min(a.ts || Date.now(), b.ts || Date.now()),
      }, { merge: true });
    } else {
      await newRef.set(oldSnap.data());
    }
    await oldRef.delete();
    participantsMoved++;
  }
  summary.participantsMoved = participantsMoved;

  // drinkLogs/shotLogs — compound `${uid}_${date}` doc ids; move by copy
  // then delete, summing counts on any same-day collision.
  for (const col of ['drinkLogs', 'shotLogs']) {
    const snap = await db.collection(col).where('userId', '==', oldUid).get();
    let moved = 0;
    for (const d of snap.docs) {
      const data = d.data();
      const newRef = db.collection(col).doc(`${newUid}_${data.date}`);
      const newSnap = await newRef.get();
      if (newSnap.exists) {
        await newRef.set({ count: (newSnap.data().count || 0) + (data.count || 0) }, { merge: true });
      } else {
        await newRef.set({ ...data, userId: newUid });
      }
      await d.ref.delete();
      moved++;
    }
    summary[col] = moved;
  }

  // Nothing of value is left on the old doc now — remove the duplicate.
  await db.collection('users').doc(oldUid).delete();
  summary.oldUserDocDeleted = true;

  return { ok: true, summary };
});

// "Find variants" in the add/edit beer/spirit form — asks Gemini (free
// tier, no billing on this project) what real-world versions of a given
// product exist (different ABV/degree, package sizes, flavors, filtered
// vs unfiltered, etc.) so the person adding it can check off the ones that
// apply instead of typing them all from memory. Purely descriptive tags on
// the beer/spirit doc — doesn't create separate ratable entries.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// The flagship "flash" tier's free quota turned out to be a mere 20
// requests/DAY, project-wide (discovered the hard way) — "flash-lite" is
// the tier actually meant for free/high-volume use and has a much larger
// separate daily allowance.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const LOOKUP_MAX_PER_DAY = 40;
const LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;

exports.lookupVariants = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  if (!request.auth?.token?.passcodeVerified) throw new HttpsError('permission-denied', 'Members only.');
  const uid = request.auth.uid;
  const name = String(request.data?.name || '').trim();
  const brewery = String(request.data?.brewery || '').trim();
  const kind = request.data?.kind === 'spirit' ? 'spirit' : request.data?.kind === 'nikotin' ? 'nikotin' : request.data?.kind === 'koffein' ? 'koffein' : 'beer';
  if (!name) throw new HttpsError('invalid-argument', 'Name required.');

  // Checked up front (read-only) so a run of transient upstream failures
  // (Gemini's free tier occasionally returns 429/503 under load) doesn't
  // burn through someone's daily quota before a single lookup has actually
  // succeeded — the counter itself only increments after a real success,
  // further down.
  const db = getFirestore();
  const rlRef = db.collection('lookupAttempts').doc(uid);
  const now = Date.now();
  const rlSnap = await rlRef.get();
  let { count: rlCount = 0, windowStart: rlWindowStart = now } = rlSnap.data() || {};
  if (now - rlWindowStart > LOOKUP_WINDOW_MS) { rlCount = 0; rlWindowStart = now; }
  if (rlCount >= LOOKUP_MAX_PER_DAY) {
    throw new HttpsError('resource-exhausted', 'Too many lookups today — try again tomorrow.');
  }

  const subject = brewery ? `"${name}" by ${brewery}` : `"${name}"`;
  const prompt = kind === 'beer'
    ? `List the real, commonly sold variants of the beer ${subject}. Include different strength/ABV versions (e.g. "10°", "11°", "12°" or "% ABV" depending on how that beer is normally labeled), different package sizes (e.g. "0.5L can", "0.33L bottle", "1.5L bottle", "draft"), and notable style variants (e.g. "unfiltered", "dark", "radler", "non-alcoholic") — only ones that genuinely exist for this specific beer. If you don't recognize this beer or aren't confident about its real variants, return an empty list rather than guessing generic ones.`
    : kind === 'spirit'
    ? `List the real, commonly sold variants of the spirit ${subject}. Include bottle sizes (e.g. "0.5L", "0.7L", "1L", "1.75L"), different ABV/proof versions if applicable, and flavor or style variants (e.g. "vanilla", "spiced", "unfiltered", "aged 12 years") — only ones that genuinely exist for this specific product. If you don't recognize this product or aren't confident about its real variants, return an empty list rather than guessing generic ones.`
    : kind === 'nikotin'
    ? `List the real, commonly sold variants of the cigarette or nicotine pouch product ${subject}. Include nicotine strength versions (e.g. "3mg", "6mg", "10mg", "16mg", or whatever unit that product is normally labeled with), flavor variants (e.g. "mint", "citrus", "berry", "menthol", "original"), and notable pack-size differences — only ones that genuinely exist for this specific product. If you don't recognize this product or aren't confident about its real variants, return an empty list rather than guessing generic ones.`
    : `List the real, commonly sold variants of the energy drink or coffee product ${subject}. Include can/bottle/pack sizes (e.g. "250ml can", "500ml can", "1L bottle"), caffeine content versions if applicable, sugar-free/zero versions, and flavor variants (e.g. "original", "tropical", "watermelon", "vanilla", "mocha") — only ones that genuinely exist for this specific product. If you don't recognize this product or aren't confident about its real variants, return an empty list rather than guessing generic ones.`;

  // The free tier shares one project-wide quota across everyone using the
  // feature, not a per-person one — so a 429 here usually means the whole
  // group's short-term allowance is briefly used up, not that any one
  // person did anything wrong. Google's 429 body names the exact wait
  // (google.rpc.RetryInfo.retryDelay) — worth honoring precisely instead of
  // guessing, but only up to a point: a delay long enough to suggest a
  // bigger (e.g. daily) quota is exhausted isn't worth blocking this
  // request for, so it fails fast with that fact instead.
  const MAX_ATTEMPTS = 3;
  const MAX_SINGLE_WAIT_MS = 10000;
  let resp, bodyText;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY.value()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { variants: { type: 'ARRAY', items: { type: 'STRING' } } },
              required: ['variants'],
            },
          },
        }),
      }
    );
    if (resp.ok) break;
    bodyText = await resp.text();
    if (resp.status !== 503 && resp.status !== 429) break;
    const retryDelayMatch = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const suggestedMs = retryDelayMatch ? Number(retryDelayMatch[1]) * 1000 : 1000 * Math.pow(2, attempt);
    if (suggestedMs > MAX_SINGLE_WAIT_MS || attempt === MAX_ATTEMPTS - 1) break;
    await new Promise((r) => setTimeout(r, suggestedMs));
  }
  if (!resp.ok) {
    if (resp.status === 429) {
      throw new HttpsError('resource-exhausted', 'The free lookup service is busy right now — try again in a minute.');
    }
    throw new HttpsError('internal', `Lookup service error (${resp.status}).`);
  }
  const payload = await resp.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = { variants: [] }; }
  const variants = Array.isArray(parsed.variants)
    ? [...new Set(parsed.variants.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()))].slice(0, 30)
    : [];

  // Only a genuine success counts against the daily quota.
  await rlRef.set({ count: rlCount + 1, windowStart: rlWindowStart }, { merge: true });

  return { variants };
});

// Lets an admin clear someone's (or their own) lookupVariants quota early —
// e.g. after a bug like the one that used to count failed/rate-limited
// attempts against the daily cap.
exports.resetLookupQuota = onCall(async (request) => {
  if (!request.auth?.token?.isAdmin) throw new HttpsError('permission-denied', 'Admin only.');
  const uid = String(request.data?.uid || request.auth.uid);
  await getFirestore().collection('lookupAttempts').doc(uid).delete();
  return { ok: true };
});

// Same literal key pair as before (never regenerated — a new key pair would
// silently invalidate every browser's existing push subscription), just
// moved into Secret Manager instead of sitting in plaintext in source,
// consistent with every other secret in this file.
const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');

function ensureVapidConfigured() {
  webpush.setVapidDetails('mailto:akos.levardy@innovatrics.com', VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
}

// Unlike a 2-person app where "notify everyone" and "notify the other
// person" are the same thing, beer has a whole friend group in it — a
// Tic Tac Toe invite has to reach only the one person it's addressed to,
// so subscriptions are keyed by uid and this looks up just that uid's.
async function notifyUser(uid, title, body) {
  if (!uid) return;
  ensureVapidConfigured();
  const snap = await getFirestore().collection('push_subscriptions').where('uid', '==', uid).get();
  const payload = JSON.stringify({ title, body });

  const seen = new Set();
  const unique = snap.docs.filter(doc => {
    const endpoint = doc.data().subscription?.endpoint;
    if (!endpoint || seen.has(endpoint)) return false;
    seen.add(endpoint);
    return true;
  });

  await Promise.all(unique.map(async doc => {
    try {
      // High urgency + a short TTL tell the push service (and the phone's
      // battery-saver/Doze scheduling) this is time-sensitive and to drop
      // it rather than deliver it stale — without this it defaults to
      // "normal" and can sit queued for minutes on a dozing device.
      await webpush.sendNotification(doc.data().subscription, payload, { TTL: 300, urgency: 'high' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await doc.ref.delete();
      } else {
        console.error('push send failed', doc.id, err.statusCode, err.body);
      }
    }
  }));
}

exports.onTttInviteCreated = onDocumentCreated({ document: 'tttInvites/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const invite = event.data.data();
  if (invite.status !== 'pending') return null;
  return notifyUser(invite.to, '🎮 Tic Tac Toe invite!', `${invite.fromName || 'Someone'} wants to play with you`);
});

// Announcements/ideas are for the whole group, not one recipient — every
// subscribed device gets notified except the person who just posted it
// (telling yourself you posted something is pointless).
async function notifyEveryone(title, body, excludeUid) {
  ensureVapidConfigured();
  const snap = await getFirestore().collection('push_subscriptions').get();
  const payload = JSON.stringify({ title, body });

  const seen = new Set();
  const unique = snap.docs.filter(doc => {
    const data = doc.data();
    if (excludeUid && data.uid === excludeUid) return false;
    const endpoint = data.subscription?.endpoint;
    if (!endpoint || seen.has(endpoint)) return false;
    seen.add(endpoint);
    return true;
  });

  await Promise.all(unique.map(async doc => {
    try {
      await webpush.sendNotification(doc.data().subscription, payload, { TTL: 300, urgency: 'high' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await doc.ref.delete();
      } else {
        console.error('push send failed', doc.id, err.statusCode, err.body);
      }
    }
  }));
}

exports.onAnnouncementCreated = onDocumentCreated({ document: 'announcements/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const a = event.data.data();
  const text = String(a.text || '').trim();
  return notifyEveryone(
    '📢 New announcement',
    `${a.authorName || 'Admin'}: ${text.slice(0, 120)}`,
    a.authorUid
  );
});

exports.onIdeaCreated = onDocumentCreated({ document: 'ideas/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const idea = event.data.data();
  const text = String(idea.text || '').trim();
  return notifyEveryone(
    '💡 New idea',
    `${idea.authorName || 'Someone'}: ${text.slice(0, 120)}`,
    idea.authorUid
  );
});

// Beers/spirits/nikotin/koffein/parties/pubs only store `createdBy` (a uid),
// not a cached display name the way announcements/ideas do — so unlike
// those, this needs one extra read to say who added it.
async function getUserName(uid) {
  if (!uid) return 'Someone';
  const snap = await getFirestore().collection('users').doc(uid).get();
  return snap.data()?.name || 'Someone';
}

// Same `name` (nickname) falling back to `realName` fallback used
// client-side by itemLabel() in index.html — kept in sync with it.
function itemLabel(data) {
  return data?.name || data?.realName || 'something new';
}

async function notifyNewItem(title, data, label) {
  const creatorName = await getUserName(data.createdBy);
  return notifyEveryone(title, `${creatorName} added ${label}`, data.createdBy);
}

exports.onBeerCreated = onDocumentCreated({ document: 'beers/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('🍺 New beer added', data, `"${itemLabel(data)}"`);
});

exports.onSpiritCreated = onDocumentCreated({ document: 'spirits/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('🥃 New alko added', data, `"${itemLabel(data)}"`);
});

exports.onNikotinCreated = onDocumentCreated({ document: 'nikotin/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('🚬 New nikotin added', data, `"${itemLabel(data)}"`);
});

exports.onKoffeinCreated = onDocumentCreated({ document: 'koffein/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('⚡ New koffein added', data, `"${itemLabel(data)}"`);
});

exports.onPartyCreated = onDocumentCreated({ document: 'parties/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('🎉 New party added', data, `"${data.name || 'a party'}"`);
});

exports.onPubCreated = onDocumentCreated({ document: 'pubs/{id}', secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] }, event => {
  const data = event.data.data();
  return notifyNewItem('🍸 New pub added', data, `"${data.name || 'a pub'}"`);
});

// ─────────────────────────────────────────────────────────────────────────
// Yearly Recap ("Your {year} in Sörök") — a once-per-year snapshot, not
// something computed live on every profile view. Closing a year walks every
// relevant collection, tallies each member's activity for that calendar
// year specifically, and freezes the result into
// yearlyRecaps/{year}/users/{uid} so it never silently changes later (e.g.
// if someone edits an old rating). This now runs on its own — autoCloseYear
// below fires every New Year's Day and closes whichever year just ended, so
// nobody has to remember to trigger it by hand. closeYear stays as an
// admin-only manual escape hatch (re-closing a year is safe and just
// overwrites) in case the schedule ever misfires and someone needs to
// re-run it from the console.
async function performCloseYear(year, closedBy) {
  const db = getFirestore();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const inYear = (ts) => typeof ts === 'number' && ts >= yearStart && ts < yearEnd;

  const usersSnap = await db.collection('users').get();
  const stats = {};
  usersSnap.docs.forEach(d => {
    stats[d.id] = {
      beersAdded: 0, spiritsAdded: 0, nikotinAdded: 0, koffeinAdded: 0,
      totalBeersDrunk: 0, totalShotsDrunk: 0, partiesJoined: 0,
      ratingsGiven: 0, reviewsWritten: 0, chipsRedeemed: 0,
      topRatedItem: null, // { label, rating, emoji }
      beerBreakdown: {}, shotBreakdown: {}, // item id -> qty, 'generic' for unspecified
    };
  });

  // Same id -> qty shape everywhere (party participant docs and manual
  // drinkLogs/shotLogs docs both use it) — just sum matching keys together.
  const mergeBreakdownInto = (target, source) => {
    Object.entries(source || {}).forEach(([k, v]) => { target[k] = (target[k] || 0) + (v || 0); });
  };

  // Items added this year.
  const itemTypes = [['beers', 'beersAdded'], ['spirits', 'spiritsAdded'], ['nikotin', 'nikotinAdded'], ['koffein', 'koffeinAdded']];
  await Promise.all(itemTypes.map(async ([col, field]) => {
    const snap = await db.collection(col).get();
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (inYear(d.ts) && stats[d.createdBy]) stats[d.createdBy][field]++;
    });
  }));

  // Ratings + written reviews across every rateable type, plus each
  // person's single highest-rated find of the year. Every parent doc's
  // ratings subcollection is fetched concurrently (not one at a time) —
  // with dozens of beers/spirits/pubs etc., sequential awaits here easily
  // ran past the callable's 60s timeout on real data.
  const RATING_EMOJI = { beers: '🍺', spirits: '🥃', nikotin: '🚬', koffein: '⚡', pubs: '🍸' };
  for (const col of Object.keys(RATING_EMOJI)) {
    const parents = await db.collection(col).get();
    await Promise.all(parents.docs.map(async (parent) => {
      const parentData = parent.data();
      const label = parentData.name || parentData.realName || 'Unnamed';
      const ratingsSnap = await parent.ref.collection('ratings').get();
      ratingsSnap.docs.forEach(rDoc => {
        const r = rDoc.data();
        const s = stats[r.userId];
        if (!s || !inYear(r.ts)) return;
        if (typeof r.rating === 'number') {
          s.ratingsGiven++;
          if (!s.topRatedItem || r.rating > s.topRatedItem.rating) {
            s.topRatedItem = { label, rating: r.rating, emoji: RATING_EMOJI[col] };
          }
        }
        if ((r.comment || '').trim()) s.reviewsWritten++;
      });
    }));
  }

  // Pub and party comments are separate multi-comment subcollections (not
  // folded into ratings the way a beer's written review is).
  for (const col of ['pubs', 'parties']) {
    const parents = await db.collection(col).get();
    await Promise.all(parents.docs.map(async (parent) => {
      const commentsSnap = await parent.ref.collection('comments').get();
      commentsSnap.docs.forEach(cDoc => {
        const c = cDoc.data();
        if (stats[c.userId] && inYear(c.ts)) stats[c.userId].reviewsWritten++;
      });
    }));
  }

  // Drinks + party attendance — scoped by the party's own `year` field
  // (when it actually happened), not by when someone got around to logging
  // it, so a party logged late still counts for the right year.
  const partiesSnap = await db.collection('parties').where('year', '==', year).get();
  await Promise.all(partiesSnap.docs.map(async (party) => {
    const participantsSnap = await party.ref.collection('participants').get();
    participantsSnap.docs.forEach(pDoc => {
      const p = pDoc.data();
      const s = stats[pDoc.id];
      if (!s) return;
      s.totalBeersDrunk += p.count || 0;
      s.totalShotsDrunk += p.shotCount || 0;
      s.partiesJoined++;
      mergeBreakdownInto(s.beerBreakdown, p.beerBreakdown);
      mergeBreakdownInto(s.shotBreakdown, p.shotBreakdown);
    });
  }));

  // The leaderboard's own total for a person is party attendance *plus*
  // whatever they logged manually outside a party (see computeStandings on
  // the client) — closeYear has to add the same two sources together or
  // its "beers drunk" would quietly undercount anyone who ever used the
  // leaderboard's own +/- instead of only ever logging through a party.
  const [drinkLogsSnap, shotLogsSnap] = await Promise.all([
    db.collection('drinkLogs').where('year', '==', year).get(),
    db.collection('shotLogs').where('year', '==', year).get(),
  ]);
  drinkLogsSnap.docs.forEach(doc => {
    const log = doc.data();
    const s = stats[log.userId];
    if (!s) return;
    s.totalBeersDrunk += log.count || 0;
    mergeBreakdownInto(s.beerBreakdown, log.breakdown);
  });
  shotLogsSnap.docs.forEach(doc => {
    const log = doc.data();
    const s = stats[log.userId];
    if (!s) return;
    s.totalShotsDrunk += log.count || 0;
    mergeBreakdownInto(s.shotBreakdown, log.breakdown);
  });

  // Chips redeemed this year (embedded array on each user's own doc).
  usersSnap.docs.forEach(doc => {
    const s = stats[doc.id];
    (doc.data().chips || []).forEach(c => {
      if (s && c.status === 'redeemed' && inYear(c.redeemedAt)) s.chipsRedeemed++;
    });
  });

  // Older data (logged before per-type breakdowns existed) has a real total
  // with no matching detail behind some of it — same "unspecified means
  // generic Sör/Alko" reasoning the party/leaderboard pickers already use
  // (withUnspecifiedGap client-side), just applied once per person here.
  Object.values(stats).forEach(s => {
    const beerKnown = Object.values(s.beerBreakdown).reduce((sum, v) => sum + (v || 0), 0);
    const beerGap = Math.max(0, s.totalBeersDrunk - beerKnown);
    if (beerGap > 0) s.beerBreakdown.generic = (s.beerBreakdown.generic || 0) + beerGap;
    const shotKnown = Object.values(s.shotBreakdown).reduce((sum, v) => sum + (v || 0), 0);
    const shotGap = Math.max(0, s.totalShotsDrunk - shotKnown);
    if (shotGap > 0) s.shotBreakdown.generic = (s.shotBreakdown.generic || 0) + shotGap;
  });

  const recapRef = db.collection('yearlyRecaps').doc(String(year));
  const userIds = Object.keys(stats);
  const CHUNK = 400; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const batch = db.batch();
    userIds.slice(i, i + CHUNK).forEach(uid => {
      batch.set(recapRef.collection('users').doc(uid), stats[uid]);
    });
    await batch.commit();
  }
  await recapRef.set({ closed: true, closedAt: Date.now(), closedBy, userCount: userIds.length });

  return { ok: true, year, userCount: userIds.length };
}

exports.closeYear = onCall(async (request) => {
  if (!request.auth?.token?.isAdmin) throw new HttpsError('permission-denied', 'Admin only.');
  const year = Number(request.data?.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new HttpsError('invalid-argument', 'Give a real year.');
  }
  return performCloseYear(year, request.auth.uid);
});

// Fires once a year, right after midnight on January 1st, and closes
// whichever year just ended — the only thing that actually keeps the
// Wrapped cards up to date now; there's no more admin button for this.
exports.autoCloseYear = onSchedule({ schedule: '0 2 1 1 *', timeZone: 'Europe/Budapest' }, async () => {
  const justEndedYear = new Date().getFullYear() - 1;
  await performCloseYear(justEndedYear, 'system');
});
