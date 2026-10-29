const test = require('node:test');
const assert = require('node:assert/strict');
const { buildView, itemsForFile } = require('../src/shared/intent-view.js');

const turns = [
  {
    id: 'cc:s1:1', agent: 'claude-code', session_id: 's1', turn_seq: 1, author: 'Dev Person', branch: 'main', started_at: '2026-01-01T10:00:00Z', ended_at: '2026-01-01T10:10:00Z',
    intent: 'Asked to add retries.', files: ['src/retry.js'], commits: ['a1'], signals: { questions_answered: 2, plans_approved: 1, mid_turn_messages: 1 },
    items: [
      { id: 'cc:s1:1#0', type: 'decision', source: 'human', title: 'No new deps', files: [] },
      { id: 'cc:s1:1#1', type: 'decision', source: 'agent', title: 'Backoff', alternatives: ['SQS'], files: ['src/retry.js'] },
      { id: 'cc:s1:1#2', type: 'decision', source: 'agent', title: 'Abandoned old client patch', files: ['src/old.js'] },
      { id: 'cc:s1:1#3', type: 'decision', source: 'human', title: 'Support Codex too', course_correction: true, files: [] },
    ],
  },
  {
    id: 'cx:s2:1', agent: 'codex', session_id: 's2', turn_seq: 1, author: 'Dev Person', branch: 'feat', started_at: '2026-01-02T10:00:00Z', ended_at: '2026-01-02T10:10:00Z',
    intent: 'Asked to add jitter.', pr_url: 'https://acme.ghe.com/a/b/pull/7',
    items: [
      { id: 'cx:s2:1#0', type: 'assumption', source: 'agent', title: 'Idempotent endpoints', files: [] },
      { id: 'cx:s2:1#1', type: 'decision', source: 'agent', title: 'Plain jitter', files: ['src/retry.js'] },
    ],
  },
];

test('without a brief: ranked attention (≤3), human rules, one chapter per turn, checkpoints', () => {
  const v = buildView({ files: ['src/retry.js'], turns });
  assert.equal(v.generated, false);
  assert.equal(v.goal, 'Asked to add retries.');
  // Assumption first, then the agent call with rejected alternatives; out-of-diff items never flagged.
  assert.deepEqual(v.attention.map((a) => a.item.title), ['Idempotent endpoints', 'Backoff', 'Plain jitter']);
  assert.deepEqual(v.rules.map((r) => r.label), ['No new deps', 'Support Codex too']);
  assert.deepEqual(v.others.map((i) => i.title), ['Abandoned old client patch']);
  assert.equal(v.others[0].inDiff, false);
  assert.equal(v.chapters.length, 2);
  assert.equal(v.chapters[0].steer, 'Support Codex too');
  assert.deepEqual(v.chapters[0].checkpoints, ['Dev answered 2 questions', 'Plan approved', '1 file changed', '1 commit']);
  assert.deepEqual(v.chapters[1].checkpoints, ['PR #7 opened']);
  assert.deepEqual(v.chapters[0].counts, { human: 2, agent: 2, check: 1, assumptions: 0 });
  assert.equal(v.authorFirst, 'Dev');
  assert.deepEqual(v.meta.agents.map((a) => a.label), ['Claude Code', 'Codex']);
  assert.deepEqual(itemsForFile(v, 'src/retry.js').map((i) => i.title), ['Backoff', 'Plain jitter']);
});

test('with a brief: uses its goal, picks, rules and chapters; newer turns get their own chapter', () => {
  const brief = {
    goal: 'Make webhook delivery survive partner outages.',
    attention: [{ item_id: 'cx:s2:1#0', why: 'Double delivery if wrong' }, { item_id: 'gone', why: 'x' }],
    rules: [{ label: 'No new deps', item_ids: ['cc:s1:1#0'] }],
    chapters: [{ title: 'Build retries', summary: 'Added backoff.', steer: 'scope widened to Codex', turn_ids: ['cc:s1:1'] }],
  };
  const v = buildView({ files: null, turns, brief });
  assert.equal(v.generated, true);
  assert.equal(v.goal, 'Make webhook delivery survive partner outages.');
  assert.deepEqual(v.attention.map((a) => [a.item.title, a.why]), [['Idempotent endpoints', 'Double delivery if wrong']]);
  assert.deepEqual(v.chapters.map((c) => c.title), ['Build retries', 'Since the last summary']);
  assert.equal(v.chapters[0].steer, 'scope widened to Codex');
  assert.equal(v.chapters[1].summary, 'Asked to add jitter.');
  assert.equal(v.others.length, 3, 'every non-human item not flagged stays reachable');
  assert.equal(v.hasFiles, false);
  assert.equal(v.counts.notInDiff, 0);
});
