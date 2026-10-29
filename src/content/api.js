(function (root) {
  const PULL_REQUEST_FIELDS = `
    number title url isDraft isReadByViewer state createdAt updatedAt headRefName baseRefName reviewDecision isInMergeQueue
    mergeQueueEntry { position state estimatedTimeToMerge mergeQueue { url } }
    author { login avatarUrl(size: 48) url __typename }
    assignees(first: 10) { nodes { login avatarUrl(size: 48) } }
    reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Team { slug combinedSlug } } } }
    reviewRequestEvents: timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 5) {
      nodes { ... on ReviewRequestedEvent { createdAt actor { login } requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Team { slug } } } }
    }
    comments { totalCount }
    labels(first: 6) { nodes { name color } }
    milestone { title }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } }
    reviews(first: 50) { nodes { state submittedAt author { login __typename } } }
  `;

  const ISSUE_FIELDS = `
    number title url state stateReason isReadByViewer createdAt updatedAt closedAt bodyText
    author { login avatarUrl(size: 48) url __typename }
    assignees(first: 10) { nodes { login avatarUrl(size: 48) } }
    comments { totalCount }
    labels(first: 6) { nodes { name color } }
    milestone { title }
    issueType { name color }
    parent { number title url }
    subIssuesSummary { total completed percentCompleted }
    issueDependenciesSummary { blockedBy totalBlockedBy blocking }
    closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { totalCount nodes { number title url state isDraft } }
  `;

  const ACTOR = 'login avatarUrl(size: 40)';
  const TIMELINE_QUERY = `
    query ($owner: String!, $name: String!, $number: Int!, $since: DateTime) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          timelineItems(since: $since, last: 30, itemTypes: [PULL_REQUEST_COMMIT, ISSUE_COMMENT, PULL_REQUEST_REVIEW, HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT, REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, LABELED_EVENT, RENAMED_TITLE_EVENT]) {
            nodes {
              __typename
              ... on PullRequestCommit { commit { messageHeadline committedDate author { name user { ${ACTOR} } } } }
              ... on IssueComment { createdAt author { ${ACTOR} } bodyText }
              ... on PullRequestReview { submittedAt state author { ${ACTOR} } bodyText }
              ... on HeadRefForcePushedEvent { createdAt actor { ${ACTOR} } }
              ... on BaseRefChangedEvent { createdAt actor { ${ACTOR} } currentRefName }
              ... on ReviewRequestedEvent { createdAt actor { ${ACTOR} } requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } } }
              ... on ReadyForReviewEvent { createdAt actor { ${ACTOR} } }
              ... on ConvertToDraftEvent { createdAt actor { ${ACTOR} } }
              ... on MergedEvent { createdAt actor { ${ACTOR} } }
              ... on ClosedEvent { createdAt actor { ${ACTOR} } }
              ... on ReopenedEvent { createdAt actor { ${ACTOR} } }
              ... on LabeledEvent { createdAt actor { ${ACTOR} } label { name } }
              ... on RenamedTitleEvent { createdAt actor { ${ACTOR} } currentTitle }
            }
          }
        }
      }
    }
  `;

  // kind: 'pull_request' or 'issue'; GitHub searches both with type ISSUE.
  const KINDS = {
    pull_request: { type: 'PullRequest', fields: PULL_REQUEST_FIELDS, qualifier: 'is:pr', implied: /(^|\s)(is:(pr|pull-request)|type:pr)(\s|$)/ },
    issue: { type: 'Issue', fields: ISSUE_FIELDS, qualifier: 'is:issue', implied: /(^|\s)(is:issue|type:issue)(\s|$)/ },
  };

  function searchQuery(kind) {
    const { type, fields } = KINDS[kind];
    return `
      query ($search: String!, $after: String, $first: Int!) {
        viewer { login }
        search(query: $search, type: ISSUE, first: $first, after: $after) {
          issueCount
          pageInfo { hasNextPage endCursor }
          nodes { ... on ${type} { ${fields} } }
        }
      }
    `;
  }

  const MAXIMUM_SEARCH_RESULTS = 200;
  const PAGE_SIZES = { first: 25, next: 50, smallest: 10 };
  const MAXIMUM_STACK_PAGES = 5;
  const TOKEN_ERRORS = new Set(['no_token', 'bad_token']);

  class GitHubError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const CONTEXT_INVALIDATED = 'context_invalidated';

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  async function callExtension(call) {
    if (!extensionAlive()) throw new GitHubError('The extension was updated or reloaded', CONTEXT_INVALIDATED);
    try {
      return await call();
    } catch (error) {
      if (!extensionAlive() || /context invalidated/i.test(error.message)) {
        throw new GitHubError('The extension was updated or reloaded', CONTEXT_INVALIDATED);
      }
      throw error;
    }
  }

  async function readLocal(key, fallback) {
    try {
      const stored = await callExtension(() => chrome.storage.local.get(key));
      return stored[key] === undefined ? fallback : stored[key];
    } catch {
      return fallback;
    }
  }

  function writeLocal(values) {
    return callExtension(() => chrome.storage.local.set(values)).catch(() => {});
  }

  async function send(message) {
    const response = await callExtension(() => chrome.runtime.sendMessage(message));
    if (!response) throw new GitHubError('The extension did not answer', 'error');
    if (!response.ok) throw new GitHubError(response.error, response.code);
    return response.data;
  }

  function searchText(owner, repository, query, kind = 'pull_request') {
    let text = query.trim();
    if (!/(^|\s)repo:/.test(text)) text += ` repo:${owner}/${repository}`;
    if (!KINDS[kind].implied.test(text)) text += ` ${KINDS[kind].qualifier}`;
    if (!/(^|\s)sort:/.test(text)) text += ' sort:created-desc';
    return text.trim();
  }

  // onPage, when given, gets the pull requests or issues found so far after each page, so a list can show them early.
  async function searchItems(owner, repository, query, { kind = 'pull_request', onPage } = {}) {
    const items = [];
    const graphql = searchQuery(kind);
    let after = null;
    let total = 0;
    let viewer = null;
    // A small first page shows something quickly; GitHub times out (502) on heavy pages, so those are asked for again smaller.
    let size = PAGE_SIZES.first;
    while (items.length < MAXIMUM_SEARCH_RESULTS) {
      let data;
      try {
        data = await send({ type: 'graphql', query: graphql, variables: { search: searchText(owner, repository, query, kind), after, first: size } });
      } catch (error) {
        if (TOKEN_ERRORS.has(error.code) || error.code === CONTEXT_INVALIDATED) throw error;
        if (size > PAGE_SIZES.smallest) {
          size = Math.max(PAGE_SIZES.smallest, Math.floor(size / 2));
          continue;
        }
        if (items.length === 0) throw error;
        return { items, total, viewer, incomplete: true };
      }
      size = PAGE_SIZES.next;
      total = data.search.issueCount;
      viewer = data.viewer ? data.viewer.login : viewer;
      items.push(...data.search.nodes.filter((node) => node && node.number));
      if (!data.search.pageInfo.hasNextPage) break;
      if (onPage) onPage({ items: [...items], total, viewer });
      after = data.search.pageInfo.endCursor;
    }
    return { items, total, viewer };
  }

  const STATE_COUNTS = {
    pull_request: { open: 'is:open', merged: 'is:merged', closed: 'is:closed is:unmerged', all: '' },
    issue: { open: 'is:open', closed: 'is:closed', all: '' },
  };

  // How many pull requests or issues each state tab holds for the GitHub-side part of a query, in one request.
  async function countItems(owner, repository, terms, kind = 'pull_request') {
    const entries = Object.entries(STATE_COUNTS[kind]);
    const variables = Object.fromEntries(entries.map(([state, qualifier]) => [state, searchText(owner, repository, `${qualifier} ${terms}`, kind)]));
    const declarations = entries.map(([state]) => `$${state}: String!`).join(', ');
    const fields = entries.map(([state]) => `${state}: search(query: $${state}, type: ISSUE, first: 1) { issueCount }`).join('\n');
    const data = await send({ type: 'graphql', query: `query (${declarations}) { ${fields} }`, variables });
    return Object.fromEntries(entries.map(([state]) => [state, data[state].issueCount]));
  }

  async function listStacks(owner, repository) {
    const stacks = [];
    try {
      for (let page = 1; page <= MAXIMUM_STACK_PAGES; page += 1) {
        const batch = await send({ type: 'rest', path: `/repos/${owner}/${repository}/stacks?per_page=100&page=${page}` });
        stacks.push(...batch);
        if (batch.length < 100) break;
      }
    } catch (error) {
      if (TOKEN_ERRORS.has(error.code)) throw error;
      return [];
    }
    return stacks;
  }

  async function stackForPullRequest(owner, repository, number) {
    try {
      const stacks = await send({ type: 'rest', path: `/repos/${owner}/${repository}/stacks?pull_request=${number}` });
      return stacks.find((stack) => stack.open) || stacks[0] || null;
    } catch (error) {
      if (TOKEN_ERRORS.has(error.code)) throw error;
      return null;
    }
  }

  async function pullRequestsByNumber(owner, repository, numbers) {
    if (numbers.length === 0) return new Map();
    const aliases = numbers.map((number) => `pr${number}: pullRequest(number: ${Number(number)}) { ${PULL_REQUEST_FIELDS} }`).join('\n');
    const query = `query ($owner: String!, $name: String!) { viewer { login } repository(owner: $owner, name: $name) { ${aliases} } }`;
    const data = await send({ type: 'graphql', query, variables: { owner, name: repository } });
    const details = new Map(Object.values(data.repository).filter(Boolean).map((pullRequest) => [pullRequest.number, pullRequest]));
    details.viewer = data.viewer ? data.viewer.login : null;
    return details;
  }

  const LAST_READ_MILLISECONDS = 60 * 1000;
  const lastReadCache = new Map();

  async function fetchLastReadTimes(owner, repository) {
    const times = new Map();
    try {
      for (let page = 1; page <= 3; page += 1) {
        const threads = await send({ type: 'rest', path: `/repos/${owner}/${repository}/notifications?all=true&per_page=100&page=${page}` });
        for (const thread of threads) {
          const match = thread.subject && thread.subject.type === 'PullRequest' && /\/pulls\/(\d+)$/.exec(thread.subject.url || '');
          if (match && !times.has(Number(match[1]))) times.set(Number(match[1]), thread.last_read_at);
        }
        if (threads.length < 100) break;
      }
    } catch (error) {
      if (error.code === CONTEXT_INVALIDATED) throw error;
    }
    return times;
  }

  async function lastReadAt(owner, repository, number) {
    const key = `${owner}/${repository}`;
    const cached = lastReadCache.get(key);
    if (!cached || Date.now() - cached.fetchedAt > LAST_READ_MILLISECONDS) {
      lastReadCache.set(key, { fetchedAt: Date.now(), times: fetchLastReadTimes(owner, repository) });
    }
    const times = await lastReadCache.get(key).times;
    return times.get(number) || null;
  }

  async function activity(owner, repository, number) {
    const since = await lastReadAt(owner, repository, number);
    const data = await send({ type: 'graphql', query: TIMELINE_QUERY, variables: { owner, name: repository, number, since } });
    return { since, viewer: data.viewer.login, nodes: data.repository.pullRequest.timelineItems.nodes };
  }

  // The last repository visited on each host, for the address bar code search when none is chosen in the settings.
  async function rememberRepository(host, repository) {
    const recent = await readLocal('recentRepositories', {});
    const repositories = recent.repositories || {};
    if (recent.lastHost === host && repositories[host] === repository) return;
    await writeLocal({ recentRepositories: { lastHost: host, repositories: { ...repositories, [host]: repository } } });
  }

  async function settings() {
    const { settings: saved = {} } = await callExtension(() => chrome.storage.sync.get('settings'));
    return { ...root.GitHubStacks.DEFAULT_SETTINGS, ...saved };
  }

  function openOptions() {
    return send({ type: 'open-options' });
  }

  // Intent Trail: decision records for a pull request, and a branch's decision history.
  function intentPullRequest(owner, repository, number, reviewer) {
    return send({ type: 'intent-pull-request', owner, repository, number, reviewer });
  }

  function intentTimeline(owner, repository, ref) {
    return send({ type: 'intent-timeline', owner, repository, ref });
  }

  function setIntentCheck(owner, repository, number, reviewer, itemId, checked) {
    return send({ type: 'intent-check', owner, repository, number, reviewer, itemId, checked });
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, {
    api: { searchItems, countItems, rememberRepository, listStacks, stackForPullRequest, pullRequestsByNumber, activity, settings, openOptions, intentPullRequest, intentTimeline, setIntentCheck, extensionAlive, readLocal, writeLocal, CONTEXT_INVALIDATED },
  });
})(globalThis);
