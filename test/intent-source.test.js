const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const notes = require('../src/shared/intent-notes.js');
const { loadPullRequest, loadTimeline } = require('../src/shared/intent-source.js');

const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const note = (cwd, object, records) => git(cwd, ['notes', '--ref', 'refs/notes/intent', 'add', '-f', '-F', '-', object], records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const keyObject = (cwd, text) => git(cwd, ['hash-object', '-w', '--stdin'], text);

// The REST endpoints the extension calls, answered from a local repository.
function fakeGitHub(cwd, pull) {
  return async (path) => {
    let m;
    if (/\/pulls\/\d+$/.test(path)) return pull;
    if (/\/pulls\/\d+\/files/.test(path)) return pull.files.map((filename) => ({ filename }));
    if (/\/pulls\/\d+\/commits/.test(path)) return pull.commits.map((sha) => ({ sha }));
    if (/\/git\/ref\/notes\/intent$/.test(path)) return { object: { sha: git(cwd, ['rev-parse', 'refs/notes/intent']) } };
    if ((m = path.match(/\/git\/commits\/(\w+)$/))) return { tree: { sha: git(cwd, ['rev-parse', `${m[1]}^{tree}`]) } };
    if ((m = path.match(/\/git\/trees\/(\w+)\?recursive=1$/))) {
      return { tree: git(cwd, ['ls-tree', '-r', m[1]]).split('\n').map((line) => { const [meta, p] = line.split('\t'); const [, type, sha] = meta.split(' '); return { path: p, type, sha }; }) };
    }
    if ((m = path.match(/\/git\/blobs\/(\w+)$/))) return { content: execFileSync('git', ['cat-file', 'blob', m[1]], { cwd }).toString('base64') };
    if ((m = path.match(/\/commits\?sha=([^&]+)/))) {
      return git(cwd, ['log', '--format=%H%x1f%P%x1f%cI%x1f%s', decodeURIComponent(m[1])]).split('\n').map((line) => {
        const [sha, parents, date, subject] = line.split('\x1f');
        return { sha, parents: parents.split(' ').filter(Boolean).map((p) => ({ sha: p })), commit: { message: subject, committer: { date } } };
      });
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
    return null;
  };
}

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'intent-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  for (const [k, v] of [['user.name', 'Dev'], ['user.email', 'dev@example.com'], ['commit.gpgsign', 'false']]) git(cwd, ['config', k, v]);
  const commit = (file, message) => {
    writeFileSync(join(cwd, file), `${message}\n`);
    git(cwd, ['add', file]);
    git(cwd, ['commit', '-q', '-m', message]);
    return git(cwd, ['rev-parse', 'HEAD']);
  };
  return { cwd, commit };
}

const turn = (id, extra = {}) => ({ v: 1, kind: 'turn', id, agent: 'claude-code', session_id: 's', turn_seq: 1, author: 'Dev', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:01:00Z', intent: `intent ${id}`, items: [{ id: `${id}#0`, type: 'assumption', source: 'agent', title: `assume ${id}`, files: ['a.js'] }], written_at: '2026-01-01T00:02:00Z', ...extra });

test('the PR ledger and branch keys match the ids git computes', async () => {
  const { cwd } = repository();
  assert.equal(await notes.ledgerKey('Example.GHE.com', 'Acme/Demo', 7), keyObject(cwd, 'intent-trail pr example.ghe.com/acme/demo#7\n'));
  assert.equal(await notes.branchKey('example.ghe.com', 'acme/demo', 'feat/x'), keyObject(cwd, 'intent-trail branch example.ghe.com/acme/demo@feat/x\n'));
});

test('a pull request gets turns from its ledger and commits, and its brief from the branch key', async () => {
  const { cwd, commit } = repository();
  commit('README.md', 'init');
  git(cwd, ['checkout', '-q', '-b', 'feat']);
  const c1 = commit('a.js', 'a');
  note(cwd, c1, [turn('t1'), turn('t1', { intent: 'older copy', written_at: '2025-01-01T00:00:00Z' })]);
  // t0 sits only in the ledger, as after a force-push dropped its commit.
  note(cwd, keyObject(cwd, 'intent-trail pr example.ghe.com/acme/demo#7\n'), [{ v: 1, kind: 'pr-ledger', id: 'pr:x', written_at: 'z' }, turn('t0')]);
  note(cwd, keyObject(cwd, 'intent-trail branch example.ghe.com/acme/demo@feat\n'), [{ v: 1, kind: 'brief', id: 'brief:x', goal: 'Ship retries', attention: [{ item_id: 't1#0', why: 'risky' }], rules: [], chapters: [], built_at: '2026-01-02', written_at: '2026-01-02' }]);

  const gh = fakeGitHub(cwd, { head: { ref: 'feat', repo: { full_name: 'acme/demo' } }, base: { ref: 'main' }, files: ['a.js'], commits: [c1] });
  const data = await loadPullRequest({ gh, host: 'example.ghe.com', owner: 'acme', repository: 'demo', number: 7 });
  assert.deepEqual(data.turns.map((t) => t.id).sort(), ['t0', 't1']);
  assert.equal(data.turns.find((t) => t.id === 't1').intent, 'intent t1', 'newest copy per id');
  assert.equal(data.brief.goal, 'Ship retries');
  assert.deepEqual([data.branch, data.base, data.files], ['feat', 'main', ['a.js']]);
  assert.deepEqual(data.sources, { notes: 2, server: false, serverError: null });

  // An optional server adds check marks; its copy of a turn wins, a newer brief wins.
  const server = async (path) => {
    assert.match(path, /^\/api\/pr\?repo=acme%2Fdemo&number=7&branch=feat&reviewer=rev$/);
    return { turns: [turn('t1', { intent: 'from server' })], brief: { goal: 'Server brief', built_at: '2026-01-03' }, checks: ['t1#0'] };
  };
  const both = await loadPullRequest({ gh, server, host: 'example.ghe.com', owner: 'acme', repository: 'demo', number: 7, reviewer: 'rev' });
  assert.equal(both.turns.find((t) => t.id === 't1').intent, 'from server');
  assert.equal(both.brief.goal, 'Server brief');
  assert.deepEqual(both.checks, ['t1#0']);
  const down = await loadPullRequest({ gh, server: async () => { throw new Error('down'); }, host: 'example.ghe.com', owner: 'acme', repository: 'demo', number: 7 });
  assert.equal(down.turns.length, 2, 'a server outage never hides the notes');
  assert.equal(down.sources.serverError, 'down');
});

test('the timeline lists first-parent commits with notes, newest first', async () => {
  const { cwd, commit } = repository();
  commit('README.md', 'init');
  git(cwd, ['checkout', '-q', '-b', 'feat']);
  const side = commit('a.js', 'feature work');
  note(cwd, side, [turn('side')]);
  git(cwd, ['checkout', '-q', 'main']);
  git(cwd, ['merge', '-q', '--no-ff', '-m', 'Merge #3', 'feat']);
  const merge = git(cwd, ['rev-parse', 'HEAD']);
  note(cwd, merge, [{ v: 1, kind: 'pr', id: 'pr:3', pr: { number: 3, title: 'Retries', merge_kind: 'merge-commit' }, written_at: 'z' }, turn('side')]);
  const direct = commit('b.js', 'hotfix');
  note(cwd, direct, [turn('hot')]);

  const tl = await loadTimeline({ gh: fakeGitHub(cwd, null), owner: 'acme', repository: 'demo' });
  assert.equal(tl.ref, 'main');
  assert.deepEqual(tl.entries.map((e) => e.subject), ['hotfix', 'Merge #3'], 'the feature commit on the merged side is not walked');
  assert.equal(tl.entries[1].records.find((r) => r.kind === 'pr').pr.number, 3);
});
