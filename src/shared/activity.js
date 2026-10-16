(function (root) {
  const SNIPPET_LENGTH = 140;

  const REVIEW_TEXT = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'requested changes',
    COMMENTED: 'reviewed',
    DISMISSED: 'had a review dismissed',
  };

  function login(actor) {
    return actor && actor.login ? actor.login : 'someone';
  }

  function avatarOf(actor) {
    return actor && actor.avatarUrl ? actor.avatarUrl : null;
  }

  function snippet(text) {
    const flat = (text || '').replace(/\s+/g, ' ').trim();
    return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH - 1)}…` : flat;
  }

  function event(node) {
    switch (node.__typename) {
      case 'PullRequestCommit': {
        const author = node.commit.author || {};
        const actor = author.user ? author.user.login : author.name || 'someone';
        return { kind: 'commit', actor, text: 'pushed a commit', detail: node.commit.messageHeadline, at: node.commit.committedDate };
      }
      case 'IssueComment':
        return { kind: 'comment', actor: login(node.author), text: 'commented', detail: snippet(node.bodyText), at: node.createdAt };
      case 'PullRequestReview':
        if (!node.submittedAt) return null;
        return {
          kind: node.state === 'APPROVED' ? 'approved' : node.state === 'CHANGES_REQUESTED' ? 'changes_requested' : 'review',
          actor: login(node.author),
          text: REVIEW_TEXT[node.state] || 'reviewed',
          detail: snippet(node.bodyText),
          at: node.submittedAt,
        };
      case 'HeadRefForcePushedEvent':
        return { kind: 'push', actor: login(node.actor), text: 'force-pushed the branch', detail: '', at: node.createdAt };
      case 'BaseRefChangedEvent':
        return { kind: 'branch', actor: login(node.actor), text: `changed the base to ${node.currentRefName}`, detail: '', at: node.createdAt };
      case 'ReviewRequestedEvent': {
        const reviewer = node.requestedReviewer && (node.requestedReviewer.login || node.requestedReviewer.name);
        return { kind: 'request', actor: login(node.actor), text: reviewer ? `requested a review from ${reviewer}` : 'requested a review', detail: '', at: node.createdAt };
      }
      case 'ReadyForReviewEvent':
        return { kind: 'ready', actor: login(node.actor), text: 'marked it ready for review', detail: '', at: node.createdAt };
      case 'ConvertToDraftEvent':
        return { kind: 'draft', actor: login(node.actor), text: 'converted it to a draft', detail: '', at: node.createdAt };
      case 'MergedEvent':
        return { kind: 'merged', actor: login(node.actor), text: 'merged it', detail: '', at: node.createdAt };
      case 'ClosedEvent':
        return { kind: 'closed', actor: login(node.actor), text: 'closed it', detail: '', at: node.createdAt };
      case 'ReopenedEvent':
        return { kind: 'reopened', actor: login(node.actor), text: 'reopened it', detail: '', at: node.createdAt };
      case 'LabeledEvent':
        return { kind: 'label', actor: login(node.actor), text: `added the ${node.label.name} label`, detail: '', at: node.createdAt };
      case 'RenamedTitleEvent':
        return { kind: 'title', actor: login(node.actor), text: 'changed the title', detail: node.currentTitle, at: node.createdAt };
      default:
        return null;
    }
  }

  function actorOf(node) {
    if (node.__typename === 'PullRequestCommit') return node.commit.author && node.commit.author.user;
    return node.author || node.actor;
  }

  const REPEATED_TEXT = {
    commit: (count) => `pushed ${count} commits`,
    push: (count) => `force-pushed the branch ${count} times`,
  };

  function describeActivity(nodes, viewerLogin = null) {
    const events = nodes
      .map((node) => {
        const described = event(node);
        return described && { ...described, avatar: avatarOf(actorOf(node)) };
      })
      .filter(Boolean).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    const grouped = [];
    for (const current of events) {
      const previous = grouped[grouped.length - 1];
      if (previous && REPEATED_TEXT[current.kind] && previous.kind === current.kind && previous.actor === current.actor) {
        previous.count += 1;
        previous.text = REPEATED_TEXT[current.kind](previous.count);
        continue;
      }
      grouped.push({ ...current, count: 1 });
    }
    return grouped.map((entry) => (viewerLogin && entry.actor === viewerLogin ? { ...entry, actor: 'You', byViewer: true } : entry));
  }

  function relativeTime(milliseconds, now) {
    const minutes = Math.max(0, Math.round((now - milliseconds) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  const api = { describeActivity, relativeTime };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
