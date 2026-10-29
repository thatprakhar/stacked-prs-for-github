// Intent Trail view model (no DOM): shared by content/intent-trail.js and the tests.
// Turns the server's turns (+ optional brief) into the three reviewer layers:
// glance (goal + counts) → brief (≤3 to check, ground rules, the rest folded) → story (chapters).
(function (root) {
  const AGENTS = {
    'claude-code': { label: 'Claude Code', color: '#C2410C' },
    codex: { label: 'Codex', color: '#10A37F' },
  };
  const MAX_ATTENTION = 3;

  function agentInfo(agent) {
    return AGENTS[agent] ?? { label: agent || 'Agent', color: '#8C959F' };
  }

  const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'the author';
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const prNumber = (url) => url?.match(/\/pull\/(\d+)/)?.[1] ?? null;

  function groupSessions(turns) {
    const sessions = new Map();
    for (const t of turns) {
      const key = `${t.agent}:${t.session_id}`;
      let s = sessions.get(key);
      if (!s) {
        s = { key, agent: t.agent, author: t.author, turns: [], start: t.started_at, end: t.ended_at };
        sessions.set(key, s);
      }
      s.turns.push(t);
      if (t.started_at < s.start) s.start = t.started_at;
      if (t.ended_at > s.end) s.end = t.ended_at;
    }
    const ordered = [...sessions.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (const s of ordered) s.turns.sort((a, b) => (a.turn_seq ?? 0) - (b.turn_seq ?? 0) || String(a.started_at).localeCompare(String(b.started_at)));
    return ordered;
  }

  // Deterministic checkpoints from turn metadata (counts only, no content).
  function checkpoints(turns, author) {
    let answered = 0;
    let plans = 0;
    let commits = 0;
    const files = new Set();
    const prs = [];
    for (const t of turns) {
      answered += t.signals?.questions_answered ?? 0;
      plans += t.signals?.plans_approved ?? 0;
      commits += t.commits?.length ?? 0;
      for (const f of t.files ?? []) files.add(f);
      const n = prNumber(t.pr_url);
      if (n && !prs.includes(n)) prs.push(n);
    }
    return [
      answered && `${firstName(author)} answered ${plural(answered, 'question')}`,
      plans && (plans === 1 ? 'Plan approved' : `${plans} plans approved`),
      files.size && `${plural(files.size, 'file')} changed`,
      commits && plural(commits, 'commit'),
      ...prs.map((n) => `PR #${n} opened`),
    ].filter(Boolean);
  }

  // Heuristic ranking when no brief exists yet: assumptions, then agent calls with trade-offs.
  function rankAttention(items) {
    const score = (i) => (i.type === 'assumption' ? 3 : i.alternatives?.length ? 2 : 1);
    return items
      .filter((i) => i.inDiff && (i.type === 'assumption' || i.source === 'agent'))
      .map((i, idx) => ({ i, idx }))
      .sort((a, b) => score(b.i) - score(a.i) || a.idx - b.idx)
      .slice(0, MAX_ATTENTION)
      .map(({ i }) => ({ item: i, why: i.rationale }));
  }

  // data: { files: string[] | null, turns: Turn[], brief?: Brief | null, checks?: string[] }
  function buildView(data) {
    const prFiles = Array.isArray(data.files) ? new Set(data.files) : null;
    const sessions = groupSessions(data.turns ?? []);
    const turns = sessions.flatMap((s) => s.turns).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
    const turnById = new Map(turns.map((t) => [t.id, t]));

    const items = [];
    for (const t of turns) {
      (t.items ?? []).forEach((it, i) => {
        const files = Array.isArray(it.files) ? it.files : [];
        // Items without files are general (constraints, approach) and always belong to the PR.
        // Items whose files are all outside the final diff are abandoned/reverted/elsewhere.
        const inDiff = !prFiles || !files.length || files.some((f) => prFiles.has(f));
        items.push({ ...it, id: it.id ?? `${t.id}#${i}`, files, inDiff, turn: t });
      });
    }
    const itemById = new Map(items.map((i) => [i.id, i]));
    const author = sessions[0]?.author ?? '';

    const b = data.brief && (data.brief.attention || data.brief.chapters) ? data.brief : null;
    let attention;
    let rules;
    let chapters;
    if (b) {
      attention = (b.attention ?? [])
        .map((a) => itemById.get(a.item_id) && { item: itemById.get(a.item_id), why: a.why || itemById.get(a.item_id).rationale })
        .filter(Boolean)
        .slice(0, MAX_ATTENTION);
      rules = (b.rules ?? []).map((r) => ({ label: r.label, items: (r.item_ids ?? []).map((id) => itemById.get(id)).filter(Boolean) }));
      chapters = (b.chapters ?? [])
        .map((c) => ({ title: c.title, summary: c.summary, steer: c.steer, turns: (c.turn_ids ?? []).map((id) => turnById.get(id)).filter(Boolean) }))
        .filter((c) => c.turns.length);
      // Turns that arrived after the brief was built get their own chapter until it's rebuilt.
      const covered = new Set(chapters.flatMap((c) => c.turns.map((t) => t.id)));
      const newer = turns.filter((t) => !covered.has(t.id));
      if (newer.length) chapters.push({ title: 'Since the last summary', summary: newer.map((t) => t.intent).filter(Boolean).join(' '), steer: '', turns: newer });
    } else {
      attention = rankAttention(items);
      const seen = new Set();
      rules = items
        .filter((i) => i.source === 'human' && i.type === 'decision' && !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase()))
        .map((i) => ({ label: i.title, items: [i] }));
      chapters = turns.map((t) => ({ title: `Turn ${t.turn_seq ?? ''}`.trim(), summary: t.intent, steer: '', turns: [t] }));
    }

    const attentionIds = new Set(attention.map((a) => a.item.id));
    const others = items.filter((i) => i.source !== 'human' && !attentionIds.has(i.id));
    const humanItems = items.filter((i) => i.source === 'human');

    for (const c of chapters) {
      const ids = new Set(c.turns.map((t) => t.id));
      c.items = items.filter((i) => ids.has(i.turn.id));
      c.steer = c.steer || c.items.find((i) => i.course_correction)?.title || '';
      c.checkpoints = checkpoints(c.turns, author);
      c.start = c.turns[0].started_at;
      c.end = c.turns.at(-1).ended_at;
      c.counts = {
        human: c.items.filter((i) => i.source === 'human').length,
        agent: c.items.filter((i) => i.source !== 'human' && i.type === 'decision').length,
        check: c.items.filter((i) => attentionIds.has(i.id)).length,
        assumptions: c.items.filter((i) => i.type === 'assumption' && !attentionIds.has(i.id)).length,
      };
    }

    const byFile = new Map();
    for (const i of items) {
      for (const f of i.files) {
        if (!byFile.has(f)) byFile.set(f, []);
        byFile.get(f).push(i);
      }
    }

    const goal = (b?.goal || turns.find((t) => t.intent)?.intent || '').trim();
    const agents = [...new Set(sessions.map((s) => s.agent))];
    const authors = [...new Set(sessions.map((s) => s.author).filter(Boolean))];

    return {
      sessions,
      turns,
      items,
      byFile,
      hasFiles: !!prFiles,
      generated: !!b,
      goal,
      attention,
      rules,
      others,
      chapters,
      author,
      authorFirst: firstName(author),
      meta: {
        agents: agents.map(agentInfo),
        authors,
        sessionCount: sessions.length,
        turnCount: turns.length,
        start: turns[0]?.started_at ?? null,
        end: turns.at(-1)?.ended_at ?? null,
      },
      counts: {
        attention: attention.length,
        rules: rules.length || humanItems.length,
        agentCalls: items.filter((i) => i.source !== 'human' && i.type === 'decision').length,
        others: others.length,
        all: items.length,
        notInDiff: items.filter((i) => !i.inDiff).length,
      },
    };
  }

  // Items a file chip should mention, attention first.
  function itemsForFile(view, path) {
    const list = view.byFile.get(path) ?? [];
    const attention = new Set(view.attention.map((a) => a.item.id));
    return [...list].sort((a, b) => Number(attention.has(b.id)) - Number(attention.has(a.id)));
  }

  const latest = (records) => {
    const byId = new Map();
    for (const r of records) {
      const prev = byId.get(r.id);
      if (!prev || String(prev.written_at ?? '') <= String(r.written_at ?? '')) byId.set(r.id, r);
    }
    return [...byId.values()];
  };

  // entries: [{ sha, date, subject, records }] for first-parent commits that carry notes (newest
  // first). One entry per merged PR (its "pr" record) or per direct commit.
  function buildTimeline(entries) {
    return (entries ?? []).map((e) => {
      const records = latest(e.records ?? []);
      const pr = records.find((r) => r.kind === 'pr')?.pr ?? null;
      const turns = records.filter((r) => r.kind === 'turn').sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
      const items = turns.flatMap((t) => t.items ?? []);
      return {
        sha: e.sha,
        date: e.date,
        subject: e.subject,
        pr,
        turns: turns.length,
        agents: [...new Set(turns.map((t) => t.agent))].map(agentInfo),
        authors: [...new Set(turns.map((t) => t.author).filter(Boolean))],
        intent: turns.find((t) => t.intent)?.intent ?? '',
        rules: items.filter((i) => i.source === 'human').map((i) => i.title),
        assumptions: items.filter((i) => i.type === 'assumption').map((i) => i.title),
        corrections: items.filter((i) => i.course_correction).map((i) => i.title),
        counts: {
          human: items.filter((i) => i.source === 'human').length,
          agent: items.filter((i) => i.source !== 'human' && i.type === 'decision').length,
          assumptions: items.filter((i) => i.type === 'assumption').length,
        },
      };
    });
  }

  const api = { buildView, buildTimeline, itemsForFile, agentInfo, plural, firstName };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { intentView: api });
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
