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
    if (login.endsWith('[bot]')) return { login, avatarUrl: identicon(login, 100), __typename: 'Bot' };
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
      timelineItems: { nodes: [] },
      reviews: { nodes: (options.reviews || []).map(([login, state]) => ({ state, author: person(login) })) },
    };
  }

  const PULL_REQUESTS = [
    pullRequest(214, '[docs] Explain the release checklist step by step', 'devon-reyes', 'devon/release-checklist', 'main', { ready: '2026-10-15T15:45:00-04:00', labels: ['docs'], comments: 1 }),
    pullRequest(213, '[search] Highlight matched terms in results', 'sam-okafor', 'sam/search-highlight', 'sam/search-ranking', { ready: '2026-10-15T13:30:00-04:00', labels: ['search'], comments: 2, unread: true }),
    pullRequest(212, '[ui] Dark mode for the account menu', 'lee-park', 'lee/account-menu-dark', 'main', { ready: '2026-10-15T09:00:00-04:00', labels: ['ui'], comments: 4, unread: true }),
    pullRequest(211, '[search] Rank results by recent sales', 'sam-okafor', 'sam/search-ranking', 'sam/search-variants', { ready: '2026-10-14T15:00:00-04:00', labels: ['search'], comments: 3 }),
    pullRequest(210, '[search] Index product variants', 'sam-okafor', 'sam/search-variants', 'main', { labels: ['search'], checks: 'FAILURE', comments: 6, reviews: [['mira-chen', 'CHANGES_REQUESTED']] }),
    pullRequest(209, '[deps] Bump the image pipeline to v4', 'renovate[bot]', 'renovate/image-pipeline-4.x', 'main', { ready: '2026-10-15T11:00:00-04:00', labels: ['dependencies'] }),
    pullRequest(207, '[checkout] Remove the legacy cart endpoint', 'mira-chen', 'mira/remove-legacy-cart', 'mira/order-summary', { draft: true, labels: ['checkout'] }),
    pullRequest(206, '[infra] Cache build layers between CI runs', 'priya-nair', 'priya/ci-layer-cache', 'main', { labels: ['infra'], comments: 2, reviews: [['lee-park', 'APPROVED']] }),
    pullRequest(205, '[checkout] Show the order summary on the review page', 'mira-chen', 'mira/order-summary', 'mira/discount-codes', { ready: '2026-10-15T14:00:00-04:00', labels: ['checkout'], comments: 1 }),
    pullRequest(203, '[checkout] Apply discount codes at the totals step', 'mira-chen', 'mira/discount-codes', 'mira/shipping-rates', { ready: '2026-10-15T10:40:00-04:00', labels: ['checkout'], checks: 'PENDING', comments: 2 }),
    pullRequest(202, '[checkout] Price shipping by weight and zone', 'mira-chen', 'mira/shipping-rates', 'mira/cart-totals', { ready: '2026-10-15T09:10:00-04:00', labels: ['checkout'], comments: 3, unread: true }),
    pullRequest(201, '[checkout] Add the cart totals service', 'mira-chen', 'mira/cart-totals', 'main', { labels: ['checkout'], comments: 5, reviews: [['devon-reyes', 'APPROVED']] }),
  ];
  const MERGED = pullRequest(198, '[checkout] Move money formatting into a shared helper', 'mira-chen', 'mira/money-format', 'main', { state: 'MERGED', labels: ['checkout'] });
  const BY_NUMBER = new Map([...PULL_REQUESTS, MERGED].map((entry) => [entry.number, entry]));

  function member(number) {
    const entry = BY_NUMBER.get(number);
    return { number, state: entry.state === 'OPEN' ? 'open' : 'closed', draft: entry.isDraft, merged_at: entry.state === 'MERGED' ? '2026-10-13T18:00:00Z' : null, head: { ref: entry.headRefName } };
  }

  const STACKS = [
    { number: 208, open: true, base: { ref: 'main' }, pull_requests: [198, 201, 202, 203, 205, 207].map(member) },
    { number: 215, open: true, base: { ref: 'main' }, pull_requests: [210, 211, 213].map(member) },
  ];

  window.GitHubStacksDemo = {
    now: NOW,
    answer(message) {
      if (message.type === 'rest') {
        const match = message.path.match(/pull_request=(\d+)/);
        if (match) return STACKS.filter((stack) => stack.pull_requests.some((entry) => entry.number === Number(match[1])));
        return STACKS;
      }
      if (message.type === 'graphql' && message.query.includes('search(')) {
        return { search: { issueCount: PULL_REQUESTS.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: PULL_REQUESTS } };
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
