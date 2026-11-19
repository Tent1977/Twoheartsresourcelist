/**
 * Server-side review screen. Pure logic so it can be unit tested without Firebase.
 * Returns the fields to update on a new review, or null if nothing changes.
 */
const moderation = require('./lib/moderation');

function decide(data, facilityInfo = {}) {
  if (!data || typeof data !== 'object') return null;
  const info = facilityInfo[data.facilityId];
  if (!info) return { status: 'held', heldReasons: ['Unknown listing'] };
  const { status, reasons } = moderation.screen(data.text, {
    confidential: Boolean(info.confidential),
    allowNumbers: info.numbers || [],
  });
  if (status === 'held' && data.status !== 'held') return { status: 'held', heldReasons: reasons };
  return null;
}

module.exports = { decide };
