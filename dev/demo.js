// Fictional data for store screenshots: answers the extension's messages without a network or a token.
(function () {
  const NOW = Date.parse('2026-10-15T16:30:00-04:00');

  function identicon(seed, hue) {
    let hash = 0;
    for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const cells = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if ((hash >> (row * 3 + column)) & 1) {
          cells.push([column, row]);
          if (column < 2) cells.push([4 - column, row]);
        }
      }
    }
    const rectangles = cells.map(([x, y]) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="1" height="1"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 6"><rect width="6" height="6" fill="#f0f0f0"/><g fill="hsl(${hue} 55% 55%)">${rectangles}</g></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  const PEOPLE = {
    'mira-chen': identicon('mira-chen', 210),
    'sam-okafor': identicon('sam-okafor', 20),
    'devon-reyes': identicon('devon-reyes', 140),
    'priya-nair': identicon('priya-nair', 280),
    'lee-park': identicon('lee-park', 330),
  };

  const LABELS = {
    checkout: '1d76db',
    search: 'fbca04',
    docs: '0075ca',
    dependencies: '0366d6',
    infra: 'd4c5f9',
    ui: 'f9d0c4',
  };

  function person(login) {
    if (login.endsWith('[bot]') || login === 'coderabbitai') return { login, avatarUrl: identicon(login, 100), __typename: 'Bot' };
    return { login, avatarUrl: PEOPLE[login], __typename: 'User' };
  }

  function pullRequest(number, title, author, head, base, options = {}) {
    return {
      number,
      title,
      url: `https://github.com/acme/storefront/pull/${number}`,
      isDraft: Boolean(options.draft),
      isReadByViewer: !options.unread,
      state: options.state || 'OPEN',
      createdAt: options.ready || '2026-10-14T10:00:00-04:00',
      headRefName: head,
      baseRefName: base,
      author: person(author),
      comments: { totalCount: options.comments || 0 },
      labels: { nodes: (options.labels || []).map((name) => ({ name, color: LABELS[name] })) },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: options.checks || 'SUCCESS' } } }] },
      updatedAt: options.updated || options.ready || '2026-10-14T10:00:00-04:00',
      reviewDecision: options.reviews && options.reviews.some(([, state]) => state === 'APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED',
      assignees: { nodes: (options.assignees || []).map(person) },
      reviewRequests: { nodes: (options.requested || []).map((login) => ({ requestedReviewer: { login } })) },
      timelineItems: { nodes: [] },
      reviews: { nodes: (options.reviews || []).map(([login, state]) => ({ state, author: person(login) })) },
    };
  }

  const PULL_REQUESTS = [
    pullRequest(214, '[docs] Explain the release checklist step by step', 'devon-reyes', 'devon/release-checklist', 'main', { ready: '2026-10-15T15:45:00-04:00', labels: ['docs'], comments: 1, requested: ['priya-nair'] }),
    pullRequest(213, '[search] Highlight matched terms in results', 'sam-okafor', 'sam/search-highlight', 'sam/search-ranking', { ready: '2026-10-15T13:30:00-04:00', labels: ['search'], comments: 2, unread: true, reviews: [['coderabbitai', 'APPROVED']] }),
    pullRequest(212, '[ui] Dark mode for the account menu', 'lee-park', 'lee/account-menu-dark', 'main', { ready: '2026-10-15T09:00:00-04:00', labels: ['ui'], comments: 4, unread: true, requested: ['priya-nair'], assignees: ['lee-park'] }),
    pullRequest(211, '[search] Rank results by recent sales', 'sam-okafor', 'sam/search-ranking', 'sam/search-variants', { ready: '2026-10-14T15:00:00-04:00', labels: ['search'], comments: 3 }),
    pullRequest(210, '[search] Index product variants', 'sam-okafor', 'sam/search-variants', 'main', { labels: ['search'], checks: 'FAILURE', comments: 6, reviews: [['mira-chen', 'CHANGES_REQUESTED']] }),
    pullRequest(209, '[deps] Bump the image pipeline to v4', 'renovate[bot]', 'renovate/image-pipeline-4.x', 'main', { ready: '2026-10-15T11:00:00-04:00', labels: ['dependencies'] }),
    pullRequest(207, '[checkout] Remove the legacy cart endpoint', 'mira-chen', 'mira/remove-legacy-cart', 'mira/order-summary', { draft: true, labels: ['checkout'] }),
    pullRequest(206, '[infra] Cache build layers between CI runs', 'priya-nair', 'priya/ci-layer-cache', 'main', { labels: ['infra'], comments: 2, reviews: [['lee-park', 'APPROVED']], assignees: ['priya-nair'] }),
    pullRequest(205, '[checkout] Show the order summary on the review page', 'mira-chen', 'mira/order-summary', 'mira/discount-codes', { ready: '2026-10-15T14:00:00-04:00', labels: ['checkout'], comments: 1 }),
    pullRequest(203, '[checkout] Apply discount codes at the totals step', 'mira-chen', 'mira/discount-codes', 'mira/shipping-rates', { ready: '2026-10-15T10:40:00-04:00', labels: ['checkout'], checks: 'PENDING', comments: 2 }),
    pullRequest(202, '[checkout] Price shipping by weight and zone', 'mira-chen', 'mira/shipping-rates', 'mira/cart-totals', { ready: '2026-10-15T09:10:00-04:00', labels: ['checkout'], comments: 3, unread: true }),
    pullRequest(201, '[checkout] Add the cart totals service', 'mira-chen', 'mira/cart-totals', 'main', { labels: ['checkout'], comments: 5, reviews: [['devon-reyes', 'APPROVED']] }),
  ];
  const MERGED = pullRequest(198, '[checkout] Move money formatting into a shared helper', 'mira-chen', 'mira/money-format', 'main', { state: 'MERGED', labels: ['checkout'] });
  function issue(number, title, author, options = {}) {
    return {
      number,
      title,
      url: `https://github.com/acme/storefront/issues/${number}`,
      state: options.closed ? 'CLOSED' : 'OPEN',
      stateReason: options.closed || null,
      isReadByViewer: !options.unread,
      createdAt: options.created || '2026-10-10T10:00:00-04:00',
      updatedAt: options.updated || '2026-10-15T12:00:00-04:00',
      closedAt: options.closed ? '2026-10-14T12:00:00-04:00' : null,
      bodyText: options.body || '',
      author: person(author),
      assignees: { nodes: (options.assignees || []).map(person) },
      comments: { totalCount: options.comments || 0 },
      labels: { nodes: (options.labels || []).map((name) => ({ name, color: LABELS[name] })) },
      milestone: options.milestone ? { title: options.milestone } : null,
      issueType: options.type ? { name: options.type[0], color: options.type[1] } : null,
      parent: options.parent ? { number: options.parent, title: 'Checkout redesign', url: `https://github.com/acme/storefront/issues/${options.parent}` } : null,
      subIssuesSummary: { total: options.subs ? options.subs[1] : 0, completed: options.subs ? options.subs[0] : 0, percentCompleted: options.subs ? Math.round((100 * options.subs[0]) / options.subs[1]) : 0 },
      issueDependenciesSummary: { blockedBy: options.blockedBy || 0, totalBlockedBy: options.blockedBy || 0, blocking: 0 },
      closedByPullRequestsReferences: { totalCount: (options.linked || []).length, nodes: (options.linked || []).map(([linked, state, draft]) => ({ number: linked, title: `Pull request ${linked}`, url: `https://github.com/acme/storefront/pull/${linked}`, state, isDraft: Boolean(draft) })) },
    };
  }

  const ISSUES = [
    issue(231, 'Checkout redesign', 'priya-nair', { type: ['Feature', 'BLUE'], milestone: 'Q4 launch', subs: [2, 5], comments: 4, assignees: ['mira-chen', 'sam-okafor'], body: 'Rebuild checkout as one page: cart totals, shipping, discounts and the order summary, so a returning customer can pay in under a minute. Each step lands as its own pull request in the checkout stack.' }),
    issue(229, 'Discount codes stack on top of sale prices', 'devon-reyes', { type: ['Bug', 'RED'], labels: ['checkout'], milestone: 'Q4 launch', parent: 231, unread: true, comments: 6, assignees: ['mira-chen'], linked: [[203, 'OPEN']], body: 'A 20% code applied to an item already on sale takes 20% off the sale price and then again off the subtotal. Expected: the code applies once, to the sale price. Seen on orders 18213 and 18240.' }),
    issue(228, '<!-- coderabbit-ai-generated:v1 -->', 'coderabbitai', { labels: ['infra'], comments: 1, body: 'Cache the image pipeline layers in CI\nThe image pipeline rebuilds every layer on each run, which adds about six minutes to every build. Reusing the layer cache between runs would bring that under a minute.' }),
    issue(226, 'Search results ignore product variants', 'sam-okafor', { type: ['Bug', 'RED'], labels: ['search'], blockedBy: 1, comments: 3, assignees: ['sam-okafor'], linked: [[210, 'OPEN'], [211, 'OPEN', true]], body: 'Searching for "blue hoodie" finds the hoodie but not its blue variant, so customers land on the default color and have to pick again. Variants need their own entries in the index.' }),
    issue(224, 'Document the release checklist', 'lee-park', { type: ['Task', 'GRAY'], labels: ['docs'], linked: [[214, 'OPEN']], body: 'Write down every step of a release, who owns it and how to roll back, so anyone on call can ship.' }),
    issue(219, 'Dark mode for the account menu', 'lee-park', { labels: ['ui'], closed: 'COMPLETED', linked: [[212, 'MERGED']], comments: 2, body: 'The account menu stays light when the rest of the site is dark.' }),
  ];

  const BY_NUMBER = new Map([...PULL_REQUESTS, MERGED].map((entry) => [entry.number, entry]));

  function member(number) {
    const entry = BY_NUMBER.get(number);
    return { number, state: entry.state === 'OPEN' ? 'open' : 'closed', draft: entry.isDraft, merged_at: entry.state === 'MERGED' ? '2026-10-13T18:00:00Z' : null, head: { ref: entry.headRefName } };
  }

  const STACKS = [
    { number: 208, open: true, base: { ref: 'main' }, pull_requests: [198, 201, 202, 203, 205, 207].map(member) },
    { number: 215, open: true, base: { ref: 'main' }, pull_requests: [210, 211, 213].map(member) },
  ];

  const LAST_READ = {
    202: '2026-10-15T11:30:00-04:00',
    212: '2026-10-15T10:15:00-04:00',
    213: '2026-10-15T14:00:00-04:00',
  };

  function actor(login) {
    return { login, avatarUrl: person(login).avatarUrl };
  }

  const ACTIVITY = {
    202: [
      { __typename: 'PullRequestReview', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-15T12:10:00-04:00', author: actor('devon-reyes'), bodyText: 'Zones 7 and 8 share a rate table now, so the weight bands double count. Can we read the bands from the zone instead?' },
      { __typename: 'PullRequestCommit', commit: { messageHeadline: 'Read weight bands from the shipping zone', committedDate: '2026-10-15T14:40:00-04:00', author: { user: actor('mira-chen') } } },
      { __typename: 'PullRequestCommit', commit: { messageHeadline: 'Cover zones 7 and 8 in the rate tests', committedDate: '2026-10-15T14:52:00-04:00', author: { user: actor('mira-chen') } } },
      { __typename: 'IssueComment', createdAt: '2026-10-15T15:05:00-04:00', author: actor('mira-chen'), bodyText: 'Done: bands now come from the zone, and the tests cover the shared table.' },
    ],
    212: [
      { __typename: 'PullRequestCommit', commit: { messageHeadline: 'Match the menu border to the dark theme', committedDate: '2026-10-15T11:20:00-04:00', author: { user: actor('lee-park') } } },
      { __typename: 'ReviewRequestedEvent', createdAt: '2026-10-15T11:25:00-04:00', actor: actor('lee-park'), requestedReviewer: { login: 'priya-nair' } },
    ],
    213: [{ __typename: 'PullRequestReview', state: 'APPROVED', submittedAt: '2026-10-15T14:20:00-04:00', author: actor('coderabbitai'), bodyText: 'Looks good: highlights escape HTML before matching.' }],
  };

  window.GitHubStacksDemo = {
    now: NOW,
    answer(message) {
      if (message.type === 'rest' && message.path.includes('/notifications')) {
        return Object.entries(LAST_READ).map(([number, lastRead]) => ({ subject: { type: 'PullRequest', url: `https://api.github.com/repos/acme/storefront/pulls/${number}` }, last_read_at: lastRead }));
      }
      if (message.type === 'graphql' && message.query.includes('timelineItems(since')) {
        const since = message.variables.since ? Date.parse(message.variables.since) : 0;
        const nodes = (ACTIVITY[message.variables.number] || []).filter((node) => Date.parse(node.submittedAt || node.createdAt || node.commit.committedDate) >= since);
        return { viewer: { login: 'priya-nair' }, repository: { pullRequest: { timelineItems: { nodes } } } };
      }
      if (message.type === 'rest') {
        const match = message.path.match(/pull_request=(\d+)/);
        if (match) return STACKS.filter((stack) => stack.pull_requests.some((entry) => entry.number === Number(match[1])));
        return STACKS;
      }
      if (message.type === 'graphql' && message.query.includes('$open') && message.variables.open.includes('is:issue')) {
        return { open: { issueCount: ISSUES.filter((entry) => entry.state === 'OPEN').length }, closed: { issueCount: 1 }, all: { issueCount: ISSUES.length } };
      }
      if (message.type === 'graphql' && message.query.includes('search(') && message.variables.search && message.variables.search.includes('is:issue')) {
        const text = message.variables.search;
        const nodes = ISSUES.filter((entry) => (/is:open/.test(text) ? entry.state === 'OPEN' : /is:closed/.test(text) ? entry.state === 'CLOSED' : true));
        return { viewer: { login: 'priya-nair' }, search: { issueCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
      }
      if (message.type === 'graphql' && message.query.includes('$open')) {
        return { open: { issueCount: PULL_REQUESTS.length }, merged: { issueCount: 1 }, closed: { issueCount: 0 }, all: { issueCount: PULL_REQUESTS.length + 1 } };
      }
      if (message.type === 'graphql' && message.query.includes('search(')) {
        const text = message.variables.search;
        const nodes = /is:open/.test(text) ? PULL_REQUESTS : /is:merged|is:closed(?! is:unmerged)/.test(text) ? [MERGED] : /is:unmerged/.test(text) ? (/is:closed/.test(text) ? [] : PULL_REQUESTS) : [...PULL_REQUESTS, MERGED];
        return { viewer: { login: 'priya-nair' }, search: { issueCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
      }
      if (message.type === 'graphql') {
        const repository = {};
        for (const [, number] of message.query.matchAll(/pr(\d+):/g)) repository[`pr${number}`] = BY_NUMBER.get(Number(number)) || null;
        return { repository };
      }
      return null;
    },
  };
})();
