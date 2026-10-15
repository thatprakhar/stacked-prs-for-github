const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/shared/work-hours.js');
const { reviewStatus, DEFAULT_SETTINGS: DEFAULTS } = require('../src/shared/review-status.js');

const DEFAULT_SETTINGS = { ...DEFAULTS, timeZone: 'America/New_York' };

const now = Date.parse('2026-10-15T16:00:00-04:00');
const author = { login: 'prakhar', __typename: 'User' };
const base = { state: 'OPEN', isDraft: false, createdAt: '2026-10-15T09:00:00-04:00', author, reviews: { nodes: [] }, timelineItems: { nodes: [] } };
const review = (login, state, typename = 'User') => ({ state, author: { login, __typename: typename } });

test('a pull request with no human review is awaiting, timed from when it was opened', () => {
  assert.deepEqual(reviewStatus(base, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 7, level: 'breached', botApprovals: [] });
});

test('the clock starts at the latest ready-for-review event, not draft creation', () => {
  const pullRequest = { ...base, timelineItems: { nodes: [{ createdAt: '2026-10-15T12:00:00-04:00' }] } };
  assert.deepEqual(reviewStatus(pullRequest, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 4, level: 'at_risk', botApprovals: [] });
});

test('bot reviews and the author replying to comments do not count as a review', () => {
  const pullRequest = { ...base, createdAt: '2026-10-15T15:00:00-04:00', reviews: { nodes: [review('coderabbit', 'CHANGES_REQUESTED', 'Bot'), review('dependabot[bot]', 'APPROVED'), review('prakhar', 'COMMENTED')] } };
  assert.deepEqual(reviewStatus(pullRequest, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 1, level: 'on_track', botApprovals: ['dependabot[bot]'] });
});

test('a bot approval is reported but keeps the clock running until a person reviews', () => {
  const pullRequest = {
    ...base,
    reviews: { nodes: [review('coderabbitai', 'CHANGES_REQUESTED', 'Bot'), review('coderabbitai', 'APPROVED', 'Bot'), review('coderabbitai', 'COMMENTED', 'Bot'), review('linter[bot]', 'CHANGES_REQUESTED')] },
  };
  assert.deepEqual(reviewStatus(pullRequest, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 7, level: 'breached', botApprovals: ['coderabbitai'] });
});

test('a comment after an approval keeps the approval', () => {
  const pullRequest = { ...base, reviews: { nodes: [review('praveen', 'APPROVED'), review('praveen', 'COMMENTED')] } };
  assert.equal(reviewStatus(pullRequest, now, DEFAULT_SETTINGS).kind, 'approved');
});

test('changes requested by any person wins over another approval', () => {
  const pullRequest = { ...base, reviews: { nodes: [review('praveen', 'APPROVED'), review('maya', 'CHANGES_REQUESTED')] } };
  assert.equal(reviewStatus(pullRequest, now, DEFAULT_SETTINGS).kind, 'changes_requested');
});

test('drafts, merged and closed pull requests are not on the clock', () => {
  assert.equal(reviewStatus({ ...base, isDraft: true }, now, DEFAULT_SETTINGS).kind, 'draft');
  assert.equal(reviewStatus({ ...base, state: 'MERGED' }, now, DEFAULT_SETTINGS).kind, 'merged');
  assert.equal(reviewStatus({ ...base, state: 'CLOSED' }, now, DEFAULT_SETTINGS).kind, 'closed');
});
