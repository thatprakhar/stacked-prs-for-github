const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/shared/work-hours.js');
const { reviewStatus, DEFAULT_SETTINGS: DEFAULTS } = require('../src/shared/review-status.js');

const DEFAULT_SETTINGS = { ...DEFAULTS, timeZone: 'America/New_York' };

const now = Date.parse('2026-10-15T16:00:00-04:00');
const author = { login: 'prakhar', __typename: 'User' };
const base = { state: 'OPEN', isDraft: false, createdAt: '2026-10-15T09:00:00-04:00', author, reviews: { nodes: [] }, timelineItems: { nodes: [] } };
const review = (login, state, typename = 'User') => ({ state, author: { login, __typename: typename } });

test('a pull request in the merge queue is queued, with its place and time to merge, and off the review clock', () => {
  const entry = { position: 2, state: 'AWAITING_CHECKS', estimatedTimeToMerge: 284, mergeQueue: { url: 'https://github.com/o/r/queue/main' } };
  assert.deepEqual(reviewStatus({ ...base, isInMergeQueue: true, mergeQueueEntry: entry }, now, DEFAULT_SETTINGS), {
    kind: 'queued',
    position: 2,
    state: 'AWAITING_CHECKS',
    secondsToMerge: 284,
    url: 'https://github.com/o/r/queue/main',
  });
  assert.equal(reviewStatus({ ...base, state: 'MERGED', isInMergeQueue: false }, now, DEFAULT_SETTINGS).kind, 'merged');
});

const timed = (login, state, submittedAt, typename = 'User') => ({ state, submittedAt, author: { login, __typename: typename } });
const requested = (login, typename = 'User') => ({ requestedReviewer: { __typename: typename, login } });
const askedAt = (createdAt, login = 'allen', typename = 'User') => ({ createdAt, actor: { login: 'prakhar' }, requestedReviewer: { __typename: typename, login } });
const changesThenAsked = {
  ...base,
  reviews: { nodes: [timed('allen', 'CHANGES_REQUESTED', '2026-10-15T10:00:00-04:00'), timed('prakhar', 'COMMENTED', '2026-10-15T11:00:00-04:00'), timed('coderabbit', 'CHANGES_REQUESTED', '2026-10-15T12:30:00-04:00', 'Bot')] },
  reviewRequests: { nodes: [requested('allen')] },
  reviewRequestEvents: { nodes: [askedAt('2026-10-15T09:00:00-04:00'), askedAt('2026-10-15T13:00:00-04:00')] },
};

test('asked to review again after changes were requested, it waits for review again, timed from the request', () => {
  const status = reviewStatus(changesThenAsked, now, DEFAULT_SETTINGS);
  assert.equal(status.kind, 'awaiting');
  assert.equal(status.hours, 3);
  assert.equal(status.level, 'at_risk');
  assert.deepEqual(status.rereview, { requestedAt: '2026-10-15T13:00:00-04:00', requestedBy: 'prakhar', author: 'prakhar', reviewers: ['allen'] });
});

test('a request made before the review, a request to a bot, or an approval is not a re-review', () => {
  const before = { ...changesThenAsked, reviewRequestEvents: { nodes: [askedAt('2026-10-15T09:00:00-04:00')] } };
  assert.equal(reviewStatus(before, now, DEFAULT_SETTINGS).kind, 'changes_requested');
  const bot = { ...changesThenAsked, reviewRequests: { nodes: [requested('coderabbit', 'Bot')] }, reviewRequestEvents: { nodes: [askedAt('2026-10-15T13:00:00-04:00', 'coderabbit', 'Bot')] } };
  assert.equal(reviewStatus(bot, now, DEFAULT_SETTINGS).kind, 'changes_requested');
  const approved = { ...changesThenAsked, reviews: { nodes: [timed('allen', 'APPROVED', '2026-10-15T10:00:00-04:00')] } };
  assert.equal(reviewStatus(approved, now, DEFAULT_SETTINGS).kind, 'approved');
  const answered = { ...changesThenAsked, reviewRequests: { nodes: [] } };
  assert.equal(reviewStatus(answered, now, DEFAULT_SETTINGS).kind, 'changes_requested');
});

test('a pull request with no human review is awaiting, timed from when it was opened', () => {
  assert.deepEqual(reviewStatus(base, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 7, level: 'breached' });
});

test('the clock starts at the latest ready-for-review event, not draft creation', () => {
  const pullRequest = { ...base, timelineItems: { nodes: [{ createdAt: '2026-10-15T12:00:00-04:00' }] } };
  assert.deepEqual(reviewStatus(pullRequest, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 4, level: 'at_risk' });
});

test('bot reviews and the author replying to comments do not count as a review', () => {
  const pullRequest = { ...base, createdAt: '2026-10-15T15:00:00-04:00', reviews: { nodes: [review('coderabbit', 'CHANGES_REQUESTED', 'Bot'), review('dependabot[bot]', 'COMMENTED'), review('prakhar', 'COMMENTED')] } };
  assert.deepEqual(reviewStatus(pullRequest, now, DEFAULT_SETTINGS), { kind: 'awaiting', hours: 1, level: 'on_track' });
});

const botApproved = {
  ...base,
  reviews: { nodes: [review('coderabbitai', 'CHANGES_REQUESTED', 'Bot'), review('coderabbitai', 'APPROVED', 'Bot'), review('coderabbitai', 'COMMENTED', 'Bot'), review('linter[bot]', 'CHANGES_REQUESTED')] },
};

test("a bot's latest approval shows as bot approved instead of the clock", () => {
  assert.deepEqual(reviewStatus(botApproved, now, DEFAULT_SETTINGS), { kind: 'bot_approved', botApprovals: ['coderabbitai'] });
});

test("a person's review wins over a bot's approval", () => {
  const pullRequest = { ...botApproved, reviews: { nodes: [...botApproved.reviews.nodes, review('maya', 'CHANGES_REQUESTED')] } };
  assert.equal(reviewStatus(pullRequest, now, DEFAULT_SETTINGS).kind, 'changes_requested');
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
