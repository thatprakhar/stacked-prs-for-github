// Intent Trail: gathers a pull request's decision records and a branch's decision history.
//   1. git notes in the repository (the durable record, written by the Intent Trail plugin)
//   2. an optional Intent Trail server, which adds check marks shared across browsers
// `gh(path)` answers a REST path with parsed JSON, or null for 404; `server(path)` is null when no
// server is configured. Used by the background worker and by dev/server.js.
(function (root) {
  const notes = (root.GitHubStacks && root.GitHubStacks.intentNotes) || require('./intent-notes.js');

  const MAX_FILE_PAGES = 3;
  const MAX_TIMELINE_ENTRIES = 40;

  async function pullRequestDetails(gh, slug, number) {
    const pr = await gh(`/repos/${slug}/pulls/${number}`);
    if (!pr) return null;
    const files = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const batch = (await gh(`/repos/${slug}/pulls/${number}/files?per_page=100&page=${page}`)) || [];
      files.push(...batch.map((file) => file.filename));
      if (batch.length < 100) break;
    }
    const commits = ((await gh(`/repos/${slug}/pulls/${number}/commits?per_page=100`)) || []).map((commit) => commit.sha);
    return { branch: pr.head?.ref ?? null, headRepository: pr.head?.repo?.full_name ?? null, base: pr.base?.ref ?? null, files, commits };
  }

  const newer = (a, b) => (!a ? b : !b ? a : String(a.built_at ?? '') >= String(b.built_at ?? '') ? a : b);

  async function loadPullRequest({ gh, server = null, host, owner, repository, number, reviewer = null }) {
    const slug = `${owner}/${repository}`;
    const details = await pullRequestDetails(gh, slug, number);
    const reader = notes.createReader(gh, { owner, repo: repository });

    // The PR's ledger (survives force-pushes) plus notes on its current commits.
    const keys = [await notes.ledgerKey(host, slug, number), ...(details ? details.commits : [])];
    const records = (await Promise.all(keys.map((key) => reader.recordsFor(key)))).flat();
    const turns = new Map(notes.latestById(records).filter((record) => record.kind === 'turn').map((turn) => [turn.id, turn]));
    const fromNotes = turns.size;
    let brief = null;
    if (details && details.branch) {
      const briefRecords = await reader.recordsFor(await notes.branchKey(host, slug, details.branch));
      brief = notes.latestById(briefRecords).find((record) => record.kind === 'brief') || null;
    }

    let checks = [];
    let fromServer = false;
    let serverError = null;
    if (server) {
      const query = new URLSearchParams({ repo: slug, number: String(number) });
      if (details && details.headRepository && details.headRepository !== slug) query.append('repo', details.headRepository);
      if (details && details.branch) query.set('branch', details.branch);
      if (reviewer) query.set('reviewer', reviewer);
      try {
        const data = await server(`/api/pr?${query}`);
        for (const turn of data.turns || []) turns.set(turn.id, turn); // same id: the server copy may be a newer re-distill
        brief = newer(brief, data.brief || null);
        checks = data.checks || [];
        fromServer = true;
      } catch (error) {
        serverError = error.message;
      }
    }

    return {
      branch: details ? details.branch : null,
      base: details ? details.base : null,
      files: details ? details.files : null,
      turns: [...turns.values()],
      brief,
      checks,
      sources: { notes: fromNotes, server: fromServer, serverError },
    };
  }

  // First-parent commits of `ref` (default branch when null) that carry intent notes, newest first.
  async function loadTimeline({ gh, owner, repository, ref = null }) {
    const base = `/repos/${owner}/${repository}`;
    const branch = ref || ((await gh(base)) || {}).default_branch || 'main';
    const commits = (await gh(`${base}/commits?sha=${encodeURIComponent(branch)}&per_page=100`)) || [];
    const chain = notes.firstParent(commits);
    const reader = notes.createReader(gh, { owner, repo: repository });
    const index = await reader.index();
    const noted = chain.filter((commit) => index.has(commit.sha)).slice(0, MAX_TIMELINE_ENTRIES);
    const entries = await Promise.all(
      noted.map(async (commit) => ({
        sha: commit.sha,
        date: commit.commit?.committer?.date ?? null,
        subject: (commit.commit?.message ?? '').split('\n')[0],
        records: await reader.recordsFor(commit.sha),
      })),
    );
    return { ref: branch, entries, scanned: chain.length };
  }

  const api = { loadPullRequest, loadTimeline };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { intentSource: api });
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
