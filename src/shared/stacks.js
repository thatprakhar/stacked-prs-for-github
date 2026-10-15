(function (root) {
  function memberState(member) {
    if (member.merged_at) return 'merged';
    if (member.state === 'closed') return 'closed';
    if (member.draft) return 'draft';
    return 'open';
  }

  function nativeStacksByPullRequest(stacks) {
    const byNumber = new Map();
    const ordered = [...stacks].sort((left, right) => Number(right.open) - Number(left.open));
    for (const stack of ordered) {
      const members = stack.pull_requests.map((member, index) => ({
        number: member.number,
        position: index + 1,
        state: memberState(member),
      }));
      const summary = {
        key: `stack-${stack.number}`,
        number: stack.number,
        inferred: false,
        open: stack.open,
        base: stack.base ? stack.base.ref : null,
        members,
      };
      for (const member of members) {
        if (!byNumber.has(member.number)) byNumber.set(member.number, summary);
      }
    }
    return byNumber;
  }

  function inferredStacksByPullRequest(pullRequests, alreadyStacked) {
    const candidates = pullRequests.filter((pullRequest) => !alreadyStacked.has(pullRequest.number));
    const byHead = new Map(candidates.map((pullRequest) => [pullRequest.headRefName, pullRequest]));
    const children = new Map();
    for (const pullRequest of candidates) {
      if (byHead.has(pullRequest.baseRefName) && byHead.get(pullRequest.baseRefName) !== pullRequest) {
        const parent = byHead.get(pullRequest.baseRefName).number;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(pullRequest);
      }
    }
    const byNumber = new Map();
    const roots = candidates.filter(
      (pullRequest) => !byHead.has(pullRequest.baseRefName) && children.has(pullRequest.number),
    );
    for (const rootPullRequest of roots) {
      const ordered = [];
      const pending = [rootPullRequest];
      const seen = new Set();
      while (pending.length > 0) {
        const current = pending.pop();
        if (seen.has(current.number)) continue;
        seen.add(current.number);
        ordered.push(current);
        const next = (children.get(current.number) || []).slice().sort((left, right) => right.number - left.number);
        pending.push(...next);
      }
      const summary = {
        key: `inferred-${rootPullRequest.number}`,
        number: null,
        inferred: true,
        open: true,
        base: rootPullRequest.baseRefName,
        members: ordered.map((pullRequest, index) => ({
          number: pullRequest.number,
          position: index + 1,
          state: pullRequest.state === 'MERGED' ? 'merged' : pullRequest.state === 'CLOSED' ? 'closed' : pullRequest.isDraft ? 'draft' : 'open',
        })),
      };
      for (const pullRequest of ordered) byNumber.set(pullRequest.number, summary);
    }
    return byNumber;
  }

  function groupPullRequests(pullRequests, stacks) {
    const stackOf = nativeStacksByPullRequest(stacks);
    for (const [number, summary] of inferredStacksByPullRequest(pullRequests, stackOf)) stackOf.set(number, summary);

    const listed = new Map(pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]));
    const entries = [];
    const emitted = new Set();
    for (const pullRequest of pullRequests) {
      const stack = stackOf.get(pullRequest.number) || null;
      const position = stack ? stack.members.find((member) => member.number === pullRequest.number).position : null;
      if (!stack) {
        entries.push({ type: 'single', pullRequest, stack: null, position: null });
        continue;
      }
      const rows = stack.members
        .filter((member) => listed.has(member.number))
        .map((member) => ({ pullRequest: listed.get(member.number), position: member.position }));
      if (rows.length < 2) {
        entries.push({ type: 'single', pullRequest, stack, position });
        continue;
      }
      if (emitted.has(stack.key)) continue;
      emitted.add(stack.key);
      entries.push({ type: 'stack', stack, rows });
    }
    return entries;
  }

  const api = { groupPullRequests };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
