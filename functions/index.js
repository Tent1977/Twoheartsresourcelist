/**
 * Shelter Watch Cloud Functions.
 * Deploy only when told to:  firebase deploy --only functions
 *
 * onReviewCreated re-runs the moderation screen on the server, because the
 * browser screen can be skipped by anyone calling Firestore directly.
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { decide } = require('./review-screen');
const facilityInfo = require('./facility-info.json');

exports.onReviewCreated = onDocumentCreated('shelterwatch_comments/{commentId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const update = decide(snap.data(), facilityInfo);
  if (update) await snap.ref.update(update);
});
