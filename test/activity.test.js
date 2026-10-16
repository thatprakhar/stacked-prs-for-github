const test = require('node:test');
const assert = require('node:assert/strict');
const { describeActivity, relativeTime } = require('../src/shared/activity.js');

const commit = (login, headline, at) => ({ __typename: 'PullRequestCommit', commit: { messageHeadline: headline, committedDate: at, author: { user: { login } } } });

test('lists events newest first and folds one person’s consecutive commits into one line', () => {
  const activity = describeActivity([
    commit('mira', 'Add totals', '2026-10-16T10:00:00Z'),
    commit('mira', 'Fix rounding', '2026-10-16T10:05:00Z'),
    { __typename: 'PullRequestReview', state: 'APPROVED', submittedAt: '2026-10-16T11:00:00Z', author: { login: 'coderabbitai' }, bodyText: '' },
    { __typename: 'IssueComment', createdAt: '2026-10-16T09:00:00Z', author: { login: 'devon' }, bodyText: 'Can we   split\nthis?' },
  ]);
  assert.deepEqual(
    activity.map(({ kind, actor, text, detail }) => [kind, actor, text, detail]),
    [
      ['approved', 'coderabbitai', 'approved', ''],
      ['commit', 'mira', 'pushed 2 commits', 'Fix rounding'],
      ['comment', 'devon', 'commented', 'Can we split this?'],
    ],
  );
});

test('skips pending reviews and event types it does not describe', () => {
  const activity = describeActivity([
    { __typename: 'PullRequestReview', state: 'PENDING', submittedAt: null, author: { login: 'maya' }, bodyText: '' },
    { __typename: 'SubscribedEvent', createdAt: '2026-10-16T09:00:00Z' },
    { __typename: 'MergedEvent', createdAt: '2026-10-16T12:00:00Z', actor: { login: 'prakhar' } },
  ]);
  assert.deepEqual(activity.map((entry) => entry.text), ['merged it']);
});

test('shortens long comments', () => {
  const [entry] = describeActivity([{ __typename: 'IssueComment', createdAt: '2026-10-16T09:00:00Z', author: { login: 'devon' }, bodyText: 'x'.repeat(500) }]);
  assert.equal(entry.detail.length, 140);
  assert.ok(entry.detail.endsWith('…'));
});

test('relative times read like GitHub’s', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(relativeTime(now - 20 * 1000, now), 'just now');
  assert.equal(relativeTime(now - 25 * 60 * 1000, now), '25m ago');
  assert.equal(relativeTime(now - 5 * 3600 * 1000, now), '5h ago');
  assert.equal(relativeTime(now - 3 * 86400 * 1000, now), '3d ago');
});

test('folds repeated force-pushes and names the viewer You', () => {
  const push = (at) => ({ __typename: 'HeadRefForcePushedEvent', createdAt: at, actor: { login: 'prakhar' } });
  const activity = describeActivity(
    [push('2026-10-16T10:00:00Z'), push('2026-10-16T10:01:00Z'), push('2026-10-16T10:02:00Z'), { __typename: 'IssueComment', createdAt: '2026-10-16T11:00:00Z', author: { login: 'allen' }, bodyText: 'Rebased?' }],
    'prakhar',
  );
  assert.deepEqual(activity.map(({ actor, text }) => [actor, text]), [['allen', 'commented'], ['You', 'force-pushed the branch 3 times']]);
});

test('a commit with no linked GitHub account uses the git author name', () => {
  const [entry] = describeActivity([{ __typename: 'PullRequestCommit', commit: { messageHeadline: 'Fix', committedDate: '2026-10-16T10:00:00Z', author: { name: 'Prakhar Nahar', user: null } } }]);
  assert.equal(entry.actor, 'Prakhar Nahar');
});
