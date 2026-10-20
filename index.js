/* Backend for the POS. Payments are handled manually by the platform owner (no payment gateway).
   Two jobs only: (1) create a new shop with its free trial, (2) enforce plan limits on the server.
   Deploy with: firebase deploy --only functions                                                  */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp();
const db = admin.firestore(), { Timestamp, FieldValue } = admin.firestore;

const TRIAL = { days: 14, maxBranches: 2, maxUsers: 5, features: { warehouse: true, refunds: true, exports: true, imports: true } };

// A new shop signs up: creates the shop, a free trial, its first branch and its admin account.
exports.registerShop = onCall(async (req) => {
  const uid = req.auth?.uid; if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { shop, name, phone } = req.data || {};
  if (!shop || !name) throw new HttpsError('invalid-argument', 'Shop name and your name are required.');
  if ((await db.doc(`users/${uid}`).get()).exists) throw new HttpsError('already-exists', 'Account already set up.');
  const email = (await admin.auth().getUser(uid)).email;
  let id; do { id = crypto.randomBytes(3).toString('hex').toUpperCase(); } while ((await db.doc(`orgs/${id}`).get()).exists);
  const expiresAt = Timestamp.fromMillis(Date.now() + TRIAL.days * 864e5);
  const plan = { plan: 'trial', planName: 'Free trial', status: 'trialing', expiresAt, maxBranches: TRIAL.maxBranches, maxUsers: TRIAL.maxUsers };
  const b = db.batch();
  b.set(db.doc(`orgs/${id}`), { name: shop, owner: uid, ownerName: name, ownerPhone: phone || '', ownerEmail: email, ...plan, created: FieldValue.serverTimestamp() });
  b.set(db.doc(`orgs/${id}/billing/subscription`), { ...plan, features: TRIAL.features });
  b.set(db.doc(`orgs/${id}/settings/shop`), { name: shop });
  b.set(db.collection(`orgs/${id}/branches`).doc(), { name: 'Main branch' });
  b.set(db.doc(`users/${uid}`), { name, phone: phone || '', email, org: id, role: 'admin', branch: null, active: true, created: FieldValue.serverTimestamp() });
  await b.commit();
  return { org: id };
});

// Plan limits enforced on the server too, so they can't be bypassed from the browser.
exports.limitBranches = onDocumentCreated('orgs/{org}/branches/{id}', async (e) => {
  const s = (await db.doc(`orgs/${e.params.org}/billing/subscription`).get()).data() || {};
  const n = (await db.collection(`orgs/${e.params.org}/branches`).count().get()).data().count;
  if (n > (s.maxBranches || 1)) await e.data.ref.delete();
});
exports.limitStaff = onDocumentWritten('users/{uid}', async (e) => {
  const a = e.data?.after?.data(); if (!a?.org || !a.role || a.active === false) return;
  const s = (await db.doc(`orgs/${a.org}/billing/subscription`).get()).data() || {};
  const n = (await db.collection('users').where('org', '==', a.org).where('active', '==', true).get()).docs.filter(d => d.data().role).length;
  if (n > (s.maxUsers || 1)) await e.data.after.ref.update({ role: null, branch: null });
});
