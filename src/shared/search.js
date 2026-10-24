(function (root) {
  const reviews = root.GitHubStacks && root.GitHubStacks.humanReviewState ? root.GitHubStacks : require('./review-status.js');

  // A query is GitHub's search syntax: words and `key:value` qualifiers, `-` to negate, commas for "any of",
  // quotes around values with spaces. Qualifiers this module understands are evaluated here, on the pull requests
  // already loaded, so they apply as you type and use the extension's own meaning (a bot review is not a review).
  // State qualifiers decide which pull requests are loaded; anything else GitHub understands is sent to GitHub.

  const STATES = ['open', 'merged', 'closed'];
  const STATE_VALUES = { open: ['open'], closed: ['merged', 'closed'], merged: ['merged'], unmerged: ['open', 'closed'] };
  // Implied by the page: every query on the pull request list is about pull requests, on the issue list about issues.
  const NO_OP = new Set(['pr', 'pull-request', 'issue']);

  const SORTS = {
    'created-desc': 'Newest',
    'created-asc': 'Oldest',
    'updated-desc': 'Recently updated',
    'updated-asc': 'Least recently updated',
    'comments-desc': 'Most commented',
    'wait-desc': 'Longest waiting for review',
  };
  const DEFAULT_SORT = 'created-desc';
  const DEFAULT_QUERY = 'is:open';

  const VALUES = {
    is: [
      ['open', 'Open'],
      ['closed', 'Closed, merged or not'],
      ['merged', 'Merged'],
      ['unmerged', 'Open, or closed without merging'],
      ['draft', 'Draft'],
      ['unread', 'Updated since you last viewed it'],
      ['stacked', 'Part of a stack'],
    ],
    review: [
      ['none', 'No review by a person yet'],
      ['approved', 'Approved by a person'],
      ['changes_requested', 'Changes requested'],
      ['commented', 'Reviewed with comments only'],
      ['bot-approved', 'Approved by a bot only'],
      ['required', 'Review required by branch protection'],
    ],
    status: [
      ['success', 'Checks passed'],
      ['failure', 'Checks failed'],
      ['pending', 'Checks running'],
    ],
    sla: [
      ['breached', 'Waited at least the SLA'],
      ['at-risk', 'Past the at-risk threshold'],
      ['on-track', 'Below the at-risk threshold'],
    ],
    draft: [
      ['true', 'Drafts only'],
      ['false', 'No drafts'],
    ],
    no: [
      ['label', 'No labels'],
      ['assignee', 'Nobody assigned'],
      ['review-requested', 'No review requested'],
      ['milestone', 'No milestone'],
    ],
    linked: [['pr', 'Has a linked pull request']],
    sort: Object.entries(SORTS),
  };

  const KEYS = [
    ['author', 'Opened by'],
    ['label', 'Has the label'],
    ['review', 'Review state'],
    ['sla', 'Review SLA'],
    ['status', 'Checks'],
    ['is', 'State, draft, updated or stacked'],
    ['review-requested', 'Review requested from'],
    ['reviewed-by', 'Reviewed by'],
    ['assignee', 'Assigned to'],
    ['head', 'From branch'],
    ['base', 'Into branch'],
    ['draft', 'Draft or not'],
    ['no', 'Missing a label, assignee or review request'],
    ['sort', 'Order'],
    ['milestone', 'In the milestone'],
    ['type', 'Issue type'],
    ['linked', 'Has a linked pull request'],
    ['involves', 'Author, assignee, mentioned or commenter (searched on GitHub)'],
  ];

  // Qualifiers GitHub's search knows that this module does not evaluate: they are sent to GitHub as they are.
  const GITHUB_ONLY = new Set([
    'involves', 'mentions', 'commenter', 'milestone', 'project', 'team-review-requested', 'created', 'updated', 'merged',
    'closed', 'comments', 'in', 'language', 'linked', 'team', 'archived', 'reactions', 'interactions', 'repo', 'org',
    'user', 'type', 'label', 'author', 'assignee', 'review-requested', 'user-review-requested', 'reviewed-by', 'review',
    'status', 'head', 'base', 'draft', 'is', 'state', 'no', 'sort', 'sla', 'reason', 'parent-issue', 'has', 'blocked-by',
    'blocking',
  ]);
  const PEOPLE_KEYS = new Set(['author', 'assignee', 'review-requested', 'user-review-requested', 'reviewed-by']);
  const LOCAL_KEYS = new Set([...PEOPLE_KEYS, 'label', 'head', 'base', 'milestone']);
  // Local qualifiers whose meaning on GitHub is the same, so they can be sent to GitHub to search beyond what is loaded.
  const SAME_ON_GITHUB = new Set([...LOCAL_KEYS, 'status', 'draft', 'type', 'linked']);

  function unquote(value) {
    return value.replace(/"/g, '');
  }

  function splitValues(raw) {
    const values = [];
    let current = '';
    let quoted = false;
    for (const character of raw) {
      if (character === '"') quoted = !quoted;
      if (character === ',' && !quoted) {
        values.push(current);
        current = '';
      } else current += character;
    }
    values.push(current);
    return values.map((value) => unquote(value).trim()).filter(Boolean);
  }

  function readToken(raw, start, end) {
    const negated = raw.length > 1 && raw.startsWith('-');
    const body = negated ? raw.slice(1) : raw;
    const match = /^([a-zA-Z][a-zA-Z-]*):(.*)$/s.exec(body);
    if (match && GITHUB_ONLY.has(match[1].toLowerCase())) {
      const key = match[1].toLowerCase();
      return { raw, start, end, negated, key, value: unquote(match[2]), values: splitValues(match[2]) };
    }
    return { raw, start, end, negated, key: null, value: unquote(body), values: [unquote(body)] };
  }

  function tokenize(text) {
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      if (/\s/.test(text[index])) {
        index += 1;
        continue;
      }
      const start = index;
      let quoted = false;
      while (index < text.length && (quoted || !/\s/.test(text[index]))) {
        if (text[index] === '"') quoted = !quoted;
        index += 1;
      }
      tokens.push(readToken(text.slice(start, index), start, index));
    }
    return tokens;
  }

  function lower(values) {
    return values.map((value) => value.toLowerCase());
  }

  // Accepts either spelling people type: at_risk or at-risk, changes-requested or changes_requested.
  function normalize(key, value) {
    const lowered = value.toLowerCase();
    if (key === 'sla' || lowered === 'bot_approved') return lowered.replace(/_/g, '-');
    if (key === 'review') return lowered.replace(/-/g, '_').replace('bot_approved', 'bot-approved');
    return lowered;
  }

  function knownValue(key, value) {
    return (VALUES[key] || []).some(([known]) => known === normalize(key, value));
  }

  // What a token is for: 'state' picks what to load, 'local' and 'text' filter here, 'github' is sent to GitHub,
  // 'sort' orders, 'ignore' is incomplete or implied (is:pr).
  function classify(token) {
    const { key } = token;
    if (key === null) return token.value === '' ? 'ignore' : 'text';
    if (token.values.length === 0) return 'ignore';
    const values = lower(token.values);
    if (key === 'sort') return 'sort';
    if ((key === 'is' || key === 'state') && values.every((value) => STATE_VALUES[value])) return 'state';
    if (key === 'is' && values.every((value) => NO_OP.has(value))) return 'ignore';
    if (key === 'type') return values.every((value) => NO_OP.has(value)) ? 'ignore' : values.some((value) => NO_OP.has(value)) ? 'github' : 'local';
    if (key === 'linked') return values.every((value) => value === 'pr') ? 'local' : 'github';
    if (key === 'is') return values.every((value) => ['draft', 'unread', 'stacked'].includes(value)) ? 'local' : 'github';
    if (key === 'no') return values.every((value) => knownValue('no', value)) ? 'local' : 'github';
    if (key === 'review' || key === 'status' || key === 'sla' || key === 'draft') {
      return values.every((value) => knownValue(key, value)) ? 'local' : 'github';
    }
    if (LOCAL_KEYS.has(key)) return 'local';
    return 'github';
  }

  function sameOnGitHub(token) {
    const kind = classify(token);
    if (kind === 'text') return true;
    if (kind !== 'local') return false;
    if (token.key === 'is') return lower(token.values).every((value) => value === 'draft');
    if (token.key === 'no') return lower(token.values).every((value) => value !== 'review-requested');
    return SAME_ON_GITHUB.has(token.key);
  }

  function stateSet(tokens) {
    let allowed = new Set(STATES);
    for (const token of tokens) {
      if (classify(token) !== 'state') continue;
      const states = new Set(lower(token.values).flatMap((value) => STATE_VALUES[value]));
      allowed = new Set([...allowed].filter((state) => (token.negated ? !states.has(state) : states.has(state))));
    }
    return allowed;
  }

  function stateQuery(states) {
    const key = STATES.filter((state) => states.has(state)).join(',');
    switch (key) {
      case 'open':
        return 'is:open';
      case 'merged,closed':
        return 'is:closed';
      case 'merged':
        return 'is:merged';
      case 'closed':
        return 'is:closed is:unmerged';
      case 'open,closed':
        return 'is:unmerged';
      case '':
        return null;
      default:
        return '';
    }
  }

  function serverSort(sort) {
    return sort === 'wait-desc' ? DEFAULT_SORT : sort;
  }

  // Splits a query into what to load from GitHub and what to filter locally.
  function planQuery(text) {
    const tokens = tokenize(text);
    const sortToken = tokens.filter((token) => classify(token) === 'sort' && SORTS[token.value.toLowerCase()]).pop();
    const sort = sortToken ? sortToken.value.toLowerCase() : DEFAULT_SORT;
    const states = stateSet(tokens);
    const githubTerms = tokens.filter((token) => classify(token) === 'github').map((token) => token.raw);
    const filters = tokens.filter((token) => ['local', 'text', 'state'].includes(classify(token)));
    const scope = stateQuery(states);
    return {
      tokens,
      sort,
      states,
      githubTerms,
      filters,
      // Words and qualifiers the user filters by, beyond the state and order.
      refining: tokens.some((token) => ['local', 'text', 'github'].includes(classify(token))),
      // What to load from GitHub (null when the states rule everything out), and in which order when it is cut short.
      scopeQuery: scope === null ? null : [scope, ...githubTerms].filter(Boolean).join(' '),
      serverSort: serverSort(sort),
      deepTerms: filters.filter(sameOnGitHub).map((token) => token.raw),
    };
  }

  function pullRequestState(pullRequest) {
    if (pullRequest.state === 'MERGED') return 'merged';
    if (pullRequest.state === 'CLOSED') return 'closed';
    return 'open';
  }

  function login(actor) {
    return actor && actor.login ? actor.login.toLowerCase() : null;
  }

  function checksState(pullRequest) {
    const node = pullRequest.commits && pullRequest.commits.nodes[0];
    const rollup = node && node.commit.statusCheckRollup;
    if (!rollup) return null;
    if (rollup.state === 'SUCCESS') return 'success';
    if (rollup.state === 'FAILURE' || rollup.state === 'ERROR') return 'failure';
    return 'pending';
  }

  function reviewCategory(pullRequest) {
    const human = reviews.humanReviewState(pullRequest);
    if (human === 'reviewed') return 'commented';
    if (human) return human;
    return reviews.botApprovals(pullRequest).length > 0 ? 'bot-approved' : 'none';
  }

  function labelNames(pullRequest) {
    return ((pullRequest.labels && pullRequest.labels.nodes) || []).map((label) => label.name.toLowerCase());
  }

  function assigneeLogins(pullRequest) {
    return ((pullRequest.assignees && pullRequest.assignees.nodes) || []).map(login).filter(Boolean);
  }

  function requestedReviewers(pullRequest, usersOnly) {
    const requests = (pullRequest.reviewRequests && pullRequest.reviewRequests.nodes) || [];
    return requests
      .map((request) => request.requestedReviewer)
      .filter((reviewer) => reviewer && (!usersOnly || reviewer.login))
      .flatMap((reviewer) => (reviewer.login ? [reviewer.login] : [reviewer.combinedSlug, reviewer.slug].filter(Boolean)))
      .map((name) => name.toLowerCase());
  }

  function reviewerLogins(pullRequest) {
    return ((pullRequest.reviews && pullRequest.reviews.nodes) || []).filter((review) => review.state !== 'PENDING').map((review) => login(review.author)).filter(Boolean);
  }

  function haystack(pullRequest) {
    return [pullRequest.title, `#${pullRequest.number}`, pullRequest.headRefName, pullRequest.baseRefName, login(pullRequest.author), ...labelNames(pullRequest), pullRequest.bodyText]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
  }

  function milestoneTitle(item) {
    return item.milestone && item.milestone.title ? item.milestone.title.toLowerCase() : null;
  }

  function issueTypeName(item) {
    return item.issueType && item.issueType.name ? item.issueType.name.toLowerCase() : null;
  }

  function linkedPullRequests(item) {
    return (item.closedByPullRequestsReferences && item.closedByPullRequestsReferences.nodes) || [];
  }

  function matchesText(pullRequest, value) {
    const word = value.toLowerCase();
    const number = /^#?(\d+)$/.exec(word);
    if (number && pullRequest.number === Number(number[1])) return true;
    if (number && word.startsWith('#')) return false;
    return haystack(pullRequest).includes(word);
  }

  // Whether one token matches; undefined when the token is GitHub's to decide. The token still being typed
  // (context.partial) matches its last value as a prefix, so the list narrows as you type instead of emptying.
  function tokenMatches(pullRequest, token, context) {
    const values = lower(token.values);
    const viewer = context.viewer ? context.viewer.toLowerCase() : null;
    const typing = context.partial === token.raw;
    const within = (list, value, index) => (typing && index === values.length - 1 ? list.some((entry) => entry.startsWith(value)) : list.includes(value));
    const people = (logins) => values.some((value, index) => within(logins, value === '@me' ? viewer : value.replace(/^@/, ''), index));
    switch (classify(token)) {
      case 'text':
        return matchesText(pullRequest, token.value);
      case 'state':
        return values.some((value) => STATE_VALUES[value].includes(pullRequestState(pullRequest)));
      case 'local':
        break;
      default:
        return undefined;
    }
    switch (token.key) {
      case 'author':
        return people([login(pullRequest.author) || 'ghost']);
      case 'assignee':
        return people(assigneeLogins(pullRequest));
      case 'review-requested':
        return people(requestedReviewers(pullRequest, false));
      case 'user-review-requested':
        return people(requestedReviewers(pullRequest, true));
      case 'reviewed-by':
        return people(reviewerLogins(pullRequest));
      case 'label': {
        const names = labelNames(pullRequest);
        return values.some((value, index) => within(names, value, index));
      }
      case 'head':
        return values.some((value, index) => within([(pullRequest.headRefName || '').toLowerCase()], value, index));
      case 'base':
        return values.some((value, index) => within([(pullRequest.baseRefName || '').toLowerCase()], value, index));
      case 'draft':
        return values.includes(String(Boolean(pullRequest.isDraft)));
      case 'status':
        return values.includes(checksState(pullRequest));
      case 'review':
        return values.some((value) =>
          value === 'required' ? pullRequest.reviewDecision === 'REVIEW_REQUIRED' : reviewCategory(pullRequest) === normalize('review', value),
        );
      case 'sla': {
        const status = context.statusOf(pullRequest);
        return status.kind === 'awaiting' && values.some((value) => normalize('sla', value) === status.level.replace('_', '-'));
      }
      case 'milestone':
        return values.some((value, index) => within([milestoneTitle(pullRequest)].filter(Boolean), value, index));
      case 'type':
        return values.some((value, index) => within([issueTypeName(pullRequest)].filter(Boolean), value, index));
      case 'linked':
        return linkedPullRequests(pullRequest).length > 0;
      case 'no':
        return values.some((value) => {
          if (value === 'label') return labelNames(pullRequest).length === 0;
          if (value === 'assignee') return assigneeLogins(pullRequest).length === 0;
          if (value === 'milestone') return milestoneTitle(pullRequest) === null;
          return requestedReviewers(pullRequest, false).length === 0;
        });
      case 'is':
        return values.some((value) => {
          if (value === 'draft') return Boolean(pullRequest.isDraft);
          if (value === 'unread') return pullRequest.isReadByViewer === false;
          return context.isStacked(pullRequest);
        });
      default:
        return undefined;
    }
  }

  // Tokens already applied by GitHub (context.handled) are trusted: GitHub's text search also reads bodies and comments.
  function matchesAll(pullRequest, tokens, context) {
    for (const token of tokens) {
      if (context.handled && context.handled.has(token.raw)) continue;
      const result = tokenMatches(pullRequest, token, context);
      if (result === undefined) continue;
      if (result === token.negated) return false;
    }
    return true;
  }

  function time(value) {
    return value ? Date.parse(value) : 0;
  }

  function sortPullRequests(pullRequests, sort, statusOf) {
    const byCreated = (left, right) => time(right.createdAt) - time(left.createdAt) || right.number - left.number;
    const compare = {
      'created-desc': byCreated,
      'created-asc': (left, right) => -byCreated(left, right),
      'updated-desc': (left, right) => time(right.updatedAt) - time(left.updatedAt) || byCreated(left, right),
      'updated-asc': (left, right) => time(left.updatedAt) - time(right.updatedAt) || byCreated(left, right),
      'comments-desc': (left, right) => (right.comments ? right.comments.totalCount : 0) - (left.comments ? left.comments.totalCount : 0) || byCreated(left, right),
      'wait-desc': (left, right) => {
        const wait = (pullRequest) => {
          const status = statusOf(pullRequest);
          return status.kind === 'awaiting' ? status.hours : -1;
        };
        return wait(right) - wait(left) || byCreated(left, right);
      },
    }[sort] || byCreated;
    return [...pullRequests].sort(compare);
  }

  // How many pull requests each value of a facet would show, with every other filter applied.
  const FACETS = {
    author: (pullRequest) => [pullRequest.author ? pullRequest.author.login : 'ghost'],
    label: (pullRequest) => ((pullRequest.labels && pullRequest.labels.nodes) || []).map((label) => label.name),
    assignee: (pullRequest) => ((pullRequest.assignees && pullRequest.assignees.nodes) || []).map((assignee) => assignee.login),
    review: (pullRequest) => [reviewCategory(pullRequest), ...(pullRequest.reviewDecision === 'REVIEW_REQUIRED' ? ['required'] : [])],
    status: (pullRequest) => [checksState(pullRequest)].filter(Boolean),
    sla: (pullRequest, context) => {
      const status = context.statusOf(pullRequest);
      return status.kind === 'awaiting' ? [status.level.replace('_', '-')] : [];
    },
    'review-requested': (pullRequest) => requestedReviewers(pullRequest, false),
    'reviewed-by': (pullRequest) => [...new Set(reviewerLogins(pullRequest))],
    is: (pullRequest, context) => [pullRequest.isDraft && 'draft', pullRequest.isReadByViewer === false && 'unread', context.isStacked(pullRequest) && 'stacked'].filter(Boolean),
    no: (pullRequest) =>
      [
        labelNames(pullRequest).length === 0 && 'label',
        assigneeLogins(pullRequest).length === 0 && 'assignee',
        requestedReviewers(pullRequest, false).length === 0 && 'review-requested',
        milestoneTitle(pullRequest) === null && 'milestone',
      ].filter(Boolean),
    head: (pullRequest) => [pullRequest.headRefName],
    base: (pullRequest) => [pullRequest.baseRefName],
    milestone: (item) => (item.milestone ? [item.milestone.title] : []),
    type: (item) => (item.issueType ? [item.issueType.name] : []),
    linked: (item) => (linkedPullRequests(item).length > 0 ? ['pr'] : []),
  };

  function facetCounts(pullRequests, filters, key, context) {
    const others = filters.filter((token) => token.key !== key || token.negated);
    const counts = new Map();
    for (const pullRequest of pullRequests) {
      if (!matchesAll(pullRequest, others, context)) continue;
      for (const value of FACETS[key](pullRequest, context)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
  }

  // Editing a query keeps the user's own words and order; only the touched qualifiers change.

  function quote(value) {
    return /[\s,"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
  }

  function join(tokens, extra = []) {
    return [...tokens.map((token) => token.raw), ...extra].join(' ');
  }

  function selectedValues(text, key) {
    return tokenize(text)
      .filter((token) => token.key === key && !token.negated && classify(token) !== 'ignore')
      .flatMap((token) => token.values);
  }

  function setValues(text, key, values) {
    const kept = tokenize(text).filter((token) => token.key !== key || token.negated);
    return join(kept, values.length > 0 ? [`${key}:${values.map(quote).join(',')}`] : []);
  }

  function hasToken(text, key, value, negated = false) {
    return tokenize(text).some((token) => token.key === key && token.negated === negated && lower(token.values).includes(value.toLowerCase()));
  }

  function toggleToken(text, key, value, negated = false) {
    const tokens = tokenize(text);
    const remaining = [];
    let removed = false;
    for (const token of tokens) {
      if (token.key === key && token.negated === negated && lower(token.values).includes(value.toLowerCase())) {
        removed = true;
        const values = token.values.filter((candidate) => candidate.toLowerCase() !== value.toLowerCase());
        if (values.length > 0) remaining.push({ raw: `${negated ? '-' : ''}${key}:${values.map(quote).join(',')}` });
        continue;
      }
      remaining.push(token);
    }
    return join(remaining, removed ? [] : [`${negated ? '-' : ''}${key}:${quote(value)}`]);
  }

  function setStates(text, states) {
    const kept = tokenize(text).filter((token) => classify(token) !== 'state' && !(token.key === 'is' && lower(token.values).every((value) => NO_OP.has(value))));
    const scope = stateQuery(new Set(states));
    return join([{ raw: scope || '' }, ...kept].filter((token) => token.raw));
  }

  function setSort(text, sort) {
    const kept = tokenize(text).filter((token) => classify(token) !== 'sort');
    return join(kept, sort === DEFAULT_SORT ? [] : [`sort:${sort}`]);
  }

  // Writes a filter back as query text: a qualifier with its values, or words for free text (key null).
  function formatToken(key, values, negated = false) {
    const sign = negated ? '-' : '';
    if (key === null) return values.map((value) => `${sign}${quote(value)}`).join(' ');
    return `${sign}${key}:${values.map(quote).join(',')}`;
  }

  // Replaces the tokens starting at the given offsets with new text, where the first of them was.
  function replaceTokens(text, starts, raws) {
    const removing = new Set(starts);
    const kept = [];
    let inserted = false;
    for (const token of tokenize(text)) {
      if (!removing.has(token.start)) {
        kept.push(token);
        continue;
      }
      if (!inserted) kept.push(...raws.filter(Boolean).map((raw) => ({ raw })));
      inserted = true;
    }
    return join(kept, inserted ? [] : raws.filter(Boolean));
  }

  // Keeps only what decides which pull requests load, for "Clear filters".
  function clearFilters(text) {
    return join(tokenize(text).filter((token) => ['state', 'sort'].includes(classify(token))));
  }

  // Autocomplete for the token at the cursor: qualifier names, then their values.
  function suggest(text, cursor, vocabulary) {
    const token = tokenize(text).find((candidate) => candidate.start <= cursor && cursor <= candidate.end);
    if (token && cursor !== token.end) return null;
    const start = token ? token.start : cursor;
    const typed = text.slice(start, cursor);
    const negation = typed.startsWith('-') ? '-' : '';
    const body = typed.slice(negation.length);
    const colon = body.indexOf(':');
    if (colon === -1) {
      const prefix = body.toLowerCase();
      const items = KEYS.filter(([key]) => key.startsWith(prefix) && key !== prefix)
        .map(([key, detail]) => ({ insert: `${negation}${key}:`, label: `${key}:`, detail, complete: false }));
      return items.length > 0 ? { start, end: cursor, items } : null;
    }
    const key = body.slice(0, colon).toLowerCase();
    const rawValue = body.slice(colon + 1);
    const comma = rawValue.lastIndexOf(',');
    const chosen = comma === -1 ? '' : rawValue.slice(0, comma + 1);
    const partial = unquote(rawValue.slice(comma + 1)).toLowerCase();
    const taken = new Set(lower(splitValues(chosen)));
    const candidates = VALUES[key] ? VALUES[key].map(([value, detail]) => ({ value, detail })) : (vocabulary[key] || []).map((entry) => (typeof entry === 'string' ? { value: entry } : entry));
    const ranked = candidates
      .filter(({ value }) => !taken.has(value.toLowerCase()))
      .map((candidate) => ({ ...candidate, at: candidate.value.toLowerCase().indexOf(partial) }))
      .filter(({ at }) => at !== -1)
      .sort((left, right) => (left.at !== 0) - (right.at !== 0));
    const items = ranked
      .filter(({ value }) => value.toLowerCase() !== partial || ranked.length > 1)
      .slice(0, 8)
      .map(({ value, detail, avatarUrl, color }) => ({ insert: `${negation}${key}:${chosen}${quote(value)} `, label: value, detail, avatarUrl, color, complete: true }));
    return items.length > 0 ? { start, end: cursor, items } : null;
  }

  const api = {
    search: {
      DEFAULT_QUERY,
      DEFAULT_SORT,
      SORTS,
      VALUES,
      tokenize,
      classify,
      planQuery,
      matchesAll,
      sortPullRequests,
      facetCounts,
      reviewCategory,
      selectedValues,
      setValues,
      hasToken,
      toggleToken,
      setStates,
      setSort,
      clearFilters,
      formatToken,
      replaceTokens,
      normalizeValue: normalize,
      FACET_KEYS: new Set(Object.keys(FACETS)),
      suggest,
      KEYS,
    },
  };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
