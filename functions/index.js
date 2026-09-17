const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const webpush = require('web-push');

initializeApp();

const VAPID_PUBLIC = 'BK47gq6up5TInkEQyAEfujd2lTADZydmAfU2obJsyt5rwbS10zhvmtcgJQ7SdS2Zxa5OfBsbCmEhR7W0k8uNTIY';
const VAPID_PRIVATE = 'eNqbAGQHoA7ZI3aEE9kr-b3PJQB_RAEt7-hP3-zqOwE';

webpush.setVapidDetails('mailto:akos.levardy@innovatrics.com', VAPID_PUBLIC, VAPID_PRIVATE);

// Unlike a 2-person app where "notify everyone" and "notify the other
// person" are the same thing, beer has a whole friend group in it — a
// Tic Tac Toe invite has to reach only the one person it's addressed to,
// so subscriptions are keyed by uid and this looks up just that uid's.
async function notifyUser(uid, title, body) {
  if (!uid) return;
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
      await webpush.sendNotification(doc.data().subscription, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await doc.ref.delete();
      }
    }
  }));
}

exports.onTttInviteCreated = onDocumentCreated('tttInvites/{id}', event => {
  const invite = event.data.data();
  if (invite.status !== 'pending') return null;
  return notifyUser(invite.to, '🎮 Tic Tac Toe invite!', `${invite.fromName || 'Someone'} wants to play with you`);
});
