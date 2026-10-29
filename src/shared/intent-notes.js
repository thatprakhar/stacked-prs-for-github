// Intent Trail: reads agent decision records from git notes (refs/notes/intent) through the
// GitHub REST API. The Intent Trail plugin writes them (one JSON record per line, newest copy per
// id wins); the plugin's README describes the format. No DOM and no chrome.* here.
(function (root) {
  function parseRecords(text) {
    return String(text ?? '')
      .split('\n')
      .flatMap((line) => {
        if (!line.startsWith('{')) return [];
        try {
          const r = JSON.parse(line);
          return r && typeof r.id === 'string' && r.v ? [r] : [];
        } catch {
          return [];
        }
      });
  }

  // Newest copy per record id (notes merge line-wise, so duplicates are expected).
  function latestById(records) {
    const byId = new Map();
    for (const r of records) {
      const prev = byId.get(r.id);
      if (!prev || String(prev.written_at ?? '') <= String(r.written_at ?? '')) byId.set(r.id, r);
    }
    return [...byId.values()];
  }

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // git's object id for a blob: sha1("blob <len>\0<content>").
  async function blobSha(text) {
    const body = new TextEncoder().encode(text);
    const header = new TextEncoder().encode(`blob ${body.length}\0`);
    const all = new Uint8Array(header.length + body.length);
    all.set(header);
    all.set(body, header.length);
    return hex(await crypto.subtle.digest('SHA-1', all));
  }

  // The deterministic objects the plugin keeps a PR's ledger and a branch's reviewer brief on.
  function ledgerKey(host, slug, number) {
    return blobSha(`intent-trail pr ${String(host).toLowerCase()}/${String(slug).toLowerCase()}#${number}\n`);
  }

  function branchKey(host, slug, branch) {
    return blobSha(`intent-trail branch ${String(host).toLowerCase()}/${String(slug).toLowerCase()}@${branch}\n`);
  }

  function decodeBase64(s) {
    const bin = atob(String(s).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  // gh(path) → parsed JSON, or null for 404. One reader per repo; the notes index is fetched once.
  function createReader(gh, { owner, repo }) {
    const base = `/repos/${owner}/${repo}`;
    let indexPromise = null;
    const blobs = new Map();
    function index() {
      indexPromise ??= (async () => {
        const ref = await gh(`${base}/git/ref/notes/intent`);
        if (!ref?.object?.sha) return new Map();
        const commit = await gh(`${base}/git/commits/${ref.object.sha}`);
        const tree = await gh(`${base}/git/trees/${commit.tree.sha}?recursive=1`);
        // Note paths are the annotated object's id, possibly split into fanout dirs (ab/cdef…).
        return new Map((tree?.tree ?? []).filter((e) => e.type === 'blob').map((e) => [e.path.replaceAll('/', ''), e.sha]));
      })();
      return indexPromise;
    }
    async function recordsFor(objectSha) {
      const idx = await index();
      const blob = idx.get(objectSha);
      if (!blob) return [];
      if (!blobs.has(blob)) blobs.set(blob, gh(`${base}/git/blobs/${blob}`).then((b) => parseRecords(decodeBase64(b?.content ?? ''))));
      return blobs.get(blob);
    }
    return { index, recordsFor };
  }

  // First-parent chain through a /commits listing (newest first), as `git log --first-parent`.
  function firstParent(commits) {
    const bySha = new Map(commits.map((c) => [c.sha, c]));
    const out = [];
    for (let c = commits[0]; c && out.length < commits.length; c = bySha.get(c.parents?.[0]?.sha)) out.push(c);
    return out;
  }

  const api = { parseRecords, latestById, blobSha, ledgerKey, branchKey, createReader, firstParent };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { intentNotes: api });
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
