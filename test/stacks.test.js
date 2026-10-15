const test = require('node:test');
const assert = require('node:assert/strict');
const { groupPullRequests } = require('../src/shared/stacks.js');

const pr = (number, headRefName, baseRefName) => ({ number, headRefName, baseRefName, state: 'OPEN', isDraft: false });
const member = (number, extra = {}) => ({ number, state: 'open', draft: false, merged_at: null, ...extra });

test('groups the listed members of a native stack in stack order, where its first member appears', () => {
  const pullRequests = [pr(9, 'loose', 'main'), pr(5, 'c', 'b'), pr(3, 'a', 'main'), pr(4, 'b', 'a')];
  const stacks = [{ number: 6, open: true, base: { ref: 'main' }, pull_requests: [member(2, { state: 'closed', merged_at: 'x' }), member(3), member(4), member(5)] }];
  const entries = groupPullRequests(pullRequests, stacks);
  assert.deepEqual(entries.map((entry) => entry.type), ['single', 'stack']);
  assert.deepEqual(entries[1].rows.map((row) => [row.pullRequest.number, row.position]), [[3, 2], [4, 3], [5, 4]]);
  assert.equal(entries[1].stack.members[0].state, 'merged');
});

test('a lone listed member of a stack stays a single row but keeps its position', () => {
  const entries = groupPullRequests([pr(5, 'c', 'b')], [{ number: 6, open: true, base: { ref: 'main' }, pull_requests: [member(3), member(4), member(5)] }]);
  assert.equal(entries[0].type, 'single');
  assert.equal(entries[0].position, 3);
});

test('an open stack wins over an old closed stack holding the same pull request', () => {
  const stacks = [
    { number: 1, open: false, base: { ref: 'main' }, pull_requests: [member(3), member(7)] },
    { number: 8, open: true, base: { ref: 'main' }, pull_requests: [member(3), member(4)] },
  ];
  const entries = groupPullRequests([pr(3, 'a', 'main'), pr(4, 'b', 'a')], stacks);
  assert.equal(entries[0].stack.number, 8);
});

test('infers a stack from branches when none is linked on GitHub', () => {
  const entries = groupPullRequests([pr(12, 'c', 'b'), pr(10, 'a', 'main'), pr(11, 'b', 'a'), pr(13, 'x', 'main')], []);
  assert.deepEqual(entries.map((entry) => entry.type), ['stack', 'single']);
  assert.equal(entries[0].stack.inferred, true);
  assert.deepEqual(entries[0].rows.map((row) => row.pullRequest.number), [10, 11, 12]);
});
