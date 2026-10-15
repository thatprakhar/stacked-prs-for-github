(function (root) {
  const PULL_REQUEST_FIELDS = `
    number title url isDraft isReadByViewer state createdAt headRefName baseRefName
    author { login avatarUrl(size: 48) url __typename }
    comments { totalCount }
    labels(first: 6) { nodes { name color } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } }
    reviews(first: 50) { nodes { state author { login __typename } } }
  `;

  const SEARCH_QUERY = `
    query ($search: String!, $after: String) {
      search(query: $search, type: ISSUE, first: 50, after: $after) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ... on PullRequest { ${PULL_REQUEST_FIELDS} } }
      }
    }
  `;

  const MAXIMUM_SEARCH_PAGES = 4;
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
    callExtension(() => chrome.storage.local.set(values)).catch(() => {});
  }

  async function send(message) {
    const response = await callExtension(() => chrome.runtime.sendMessage(message));
    if (!response) throw new GitHubError('The extension did not answer', 'error');
    if (!response.ok) throw new GitHubError(response.error, response.code);
    return response.data;
  }

  function searchText(owner, repository, query) {
    let text = query.trim();
    if (!/(^|\s)repo:/.test(text)) text += ` repo:${owner}/${repository}`;
    if (!/(^|\s)is:(pr|pull-request)(\s|$)/.test(text) && !/(^|\s)type:pr(\s|$)/.test(text)) text += ' is:pr';
    if (!/(^|\s)sort:/.test(text)) text += ' sort:created-desc';
    return text.trim();
  }

  async function searchPullRequests(owner, repository, query) {
    const pullRequests = [];
    let after = null;
    let total = 0;
    for (let page = 0; page < MAXIMUM_SEARCH_PAGES; page += 1) {
      const data = await send({ type: 'graphql', query: SEARCH_QUERY, variables: { search: searchText(owner, repository, query), after } });
      total = data.search.issueCount;
      pullRequests.push(...data.search.nodes.filter((node) => node && node.number));
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return { pullRequests, total };
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
    const query = `query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
    const data = await send({ type: 'graphql', query, variables: { owner, name: repository } });
    return new Map(Object.values(data.repository).filter(Boolean).map((pullRequest) => [pullRequest.number, pullRequest]));
  }

  async function settings() {
    const { settings: saved = {} } = await callExtension(() => chrome.storage.sync.get('settings'));
    return { ...root.GitHubStacks.DEFAULT_SETTINGS, ...saved };
  }

  function openOptions() {
    return send({ type: 'open-options' });
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, {
    api: { searchPullRequests, listStacks, stackForPullRequest, pullRequestsByNumber, settings, openOptions, extensionAlive, readLocal, writeLocal, CONTEXT_INVALIDATED },
  });
})(globalThis);
