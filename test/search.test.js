const test = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../src/shared/search.js');

const person = (login, __typename = 'User') => ({ login, __typename });
const pr = (number, options = {}) => ({
  number,
  title: options.title || `Pull request ${number}`,
  state: options.state || 'OPEN',
  isDraft: Boolean(options.draft),
  isReadByViewer: !options.unread,
  createdAt: options.createdAt || `2026-10-0${(number % 9) + 1}T10:00:00Z`,
  updatedAt: options.updatedAt || null,
  headRefName: options.head || `branch-${number}`,
  baseRefName: options.base || 'main',
  author: person(options.author || 'mira'),
  labels: { nodes: (options.labels || []).map((name) => ({ name, color: 'ffffff' })) },
  assignees: { nodes: (options.assignees || []).map((login) => ({ login })) },
  reviewRequests: { nodes: (options.requested || []).map((login) => ({ requestedReviewer: { login } })) },
  reviewDecision: options.reviewDecision || null,
  comments: { totalCount: options.comments || 0 },
  commits: { nodes: [{ commit: { statusCheckRollup: options.checks ? { state: options.checks } : null } }] },
  reviews: { nodes: (options.reviews || []).map(([login, state, type]) => ({ state, author: person(login, type) })) },
});

const context = (extra = {}) => ({ viewer: 'priya', statusOf: () => ({ kind: 'awaiting', level: 'on_track', hours: 1 }), isStacked: () => false, ...extra });
const filter = (pullRequests, query, extra) => {
  const plan = search.planQuery(query);
  return pullRequests.filter((pullRequest) => search.matchesAll(pullRequest, plan.filters, context(extra))).map((pullRequest) => pullRequest.number);
};

test('splits a query into the state to load, GitHub-only qualifiers and local filters', () => {
  const plan = search.planQuery('is:open author:mira project:"Q4 launch" checkout sort:updated-desc');
  assert.equal(plan.scopeQuery, 'is:open project:"Q4 launch"');
  assert.equal(plan.serverSort, 'updated-desc');
  assert.deepEqual(plan.filters.map((token) => token.raw), ['is:open', 'author:mira', 'checkout']);
  assert.equal(plan.sort, 'updated-desc');
  assert.deepEqual(plan.deepTerms, ['author:mira', 'checkout']);
});

test('state qualifiers combine into one GitHub state', () => {
  assert.equal(search.planQuery('is:closed -is:merged').scopeQuery, 'is:closed is:unmerged');
  assert.equal(search.planQuery('state:closed').scopeQuery, 'is:closed');
  assert.equal(search.planQuery('is:pr is:merged').scopeQuery, 'is:merged');
  assert.equal(search.planQuery('').scopeQuery, '');
  assert.equal(search.planQuery('is:open is:merged').scopeQuery, null);
});

test('free text matches title, number, branch, author and labels, and can be negated', () => {
  const pullRequests = [pr(1, { title: 'Add cart totals' }), pr(12, { head: 'sam/search-rank', author: 'sam' }), pr(123, { labels: ['checkout'] })];
  assert.deepEqual(filter(pullRequests, 'cart'), [1]);
  assert.deepEqual(filter(pullRequests, '#12'), [12]);
  assert.deepEqual(filter(pullRequests, 'search-rank'), [12]);
  assert.deepEqual(filter(pullRequests, 'sam'), [12]);
  assert.deepEqual(filter(pullRequests, 'CHECKOUT'), [123]);
  assert.deepEqual(filter(pullRequests, '-cart'), [12, 123]);
  assert.deepEqual(filter(pullRequests, '"cart totals"'), [1]);
});

test('commas mean any of, repeated qualifiers mean all of', () => {
  const pullRequests = [pr(1, { labels: ['ui'] }), pr(2, { labels: ['docs'] }), pr(3, { labels: ['ui', 'docs'] })];
  assert.deepEqual(filter(pullRequests, 'label:ui,docs'), [1, 2, 3]);
  assert.deepEqual(filter(pullRequests, 'label:ui label:docs'), [3]);
  assert.deepEqual(filter(pullRequests, '-label:docs'), [1]);
  assert.deepEqual(filter([pr(4, { labels: ['needs review'] }), ...pullRequests], 'label:"needs review"'), [4]);
  assert.deepEqual(filter([pr(5), ...pullRequests], 'no:label'), [5]);
});

test('people qualifiers understand @me', () => {
  const pullRequests = [pr(1, { author: 'priya' }), pr(2, { requested: ['priya'] }), pr(3, { assignees: ['priya'] }), pr(4, { reviews: [['priya', 'COMMENTED']] })];
  assert.deepEqual(filter(pullRequests, 'author:@me'), [1]);
  assert.deepEqual(filter(pullRequests, 'review-requested:@me'), [2]);
  assert.deepEqual(filter(pullRequests, 'assignee:priya'), [3]);
  assert.deepEqual(filter(pullRequests, 'reviewed-by:@me'), [4]);
});

test('review state ignores bot reviews, unlike GitHub review:none', () => {
  const pullRequests = [
    pr(1, { reviews: [['coderabbitai', 'COMMENTED', 'Bot']] }),
    pr(2, { reviews: [['coderabbitai', 'APPROVED', 'Bot']] }),
    pr(3, { reviews: [['devon', 'APPROVED']] }),
    pr(4, { reviews: [['devon', 'CHANGES_REQUESTED']] }),
  ];
  assert.deepEqual(filter(pullRequests, 'review:none'), [1]);
  assert.deepEqual(filter(pullRequests, 'review:bot-approved'), [2]);
  assert.deepEqual(filter(pullRequests, 'review:bot_approved'), [2]);
  assert.deepEqual(filter(pullRequests, 'review:approved'), [3]);
  assert.deepEqual(filter(pullRequests, 'review:changes-requested'), [4]);
  const asked = {
    ...pr(5, { reviews: [['devon', 'CHANGES_REQUESTED']], requested: ['devon'] }),
    reviewRequestEvents: { nodes: [{ createdAt: '2026-10-20T10:00:00Z', requestedReviewer: { __typename: 'User', login: 'devon' } }] },
  };
  asked.reviews.nodes[0].submittedAt = '2026-10-19T10:00:00Z';
  assert.deepEqual(filter([...pullRequests, asked], 'review:re-requested'), [5]);
  assert.deepEqual(filter([...pullRequests, asked], 'review:changes_requested'), [4]);
});

test('checks, drafts, updates, stacks and SLA filter locally', () => {
  const pullRequests = [pr(1, { checks: 'SUCCESS' }), pr(2, { checks: 'ERROR', draft: true }), pr(3, { checks: 'PENDING', unread: true })];
  assert.deepEqual(filter(pullRequests, 'status:failure'), [2]);
  assert.deepEqual(filter(pullRequests, '-is:draft'), [1, 3]);
  assert.deepEqual(filter(pullRequests, 'draft:true'), [2]);
  assert.deepEqual(filter(pullRequests, 'is:unread'), [3]);
  assert.deepEqual(filter(pullRequests, 'is:stacked', { isStacked: (pullRequest) => pullRequest.number === 1 }), [1]);
  const statusOf = (pullRequest) => (pullRequest.number === 2 ? { kind: 'draft' } : { kind: 'awaiting', level: pullRequest.number === 1 ? 'breached' : 'at_risk', hours: 1 });
  assert.deepEqual(filter(pullRequests, 'sla:breached,at-risk', { statusOf }), [1, 3]);
  assert.deepEqual(filter(pullRequests, 'sla:at_risk', { statusOf }), [3]);
});

test('issues filter by milestone, type, linked pull requests and words in the description', () => {
  const issue = (number, extra) => ({ ...pr(number), headRefName: undefined, baseRefName: undefined, ...extra });
  const issues = [
    issue(1, { milestone: { title: 'Q4 launch' }, issueType: { name: 'Bug' }, bodyText: 'The worker cannot reach the database' }),
    issue(2, { issueType: { name: 'Feature' }, closedByPullRequestsReferences: { nodes: [{ number: 9 }] } }),
    issue(3),
  ];
  assert.deepEqual(filter(issues, 'milestone:"q4 launch"'), [1]);
  assert.deepEqual(filter(issues, 'no:milestone'), [2, 3]);
  assert.deepEqual(filter(issues, 'type:bug'), [1]);
  assert.deepEqual(filter(issues, '-type:bug'), [2, 3]);
  assert.deepEqual(filter(issues, 'linked:pr'), [2]);
  assert.deepEqual(filter(issues, 'database'), [1]);
  assert.equal(search.planQuery('is:issue is:open type:Bug').scopeQuery, 'is:open');
  assert.equal(search.planQuery('is:closed reason:"not planned"').scopeQuery, 'is:closed reason:"not planned"');
  assert.deepEqual(search.planQuery('type:issue milestone:v2 linked:pr').deepTerms, ['milestone:v2', 'linked:pr']);
});

test('the qualifier being typed matches as a prefix', () => {
  const pullRequests = [pr(1, { author: 'sam-okafor' }), pr(2, { author: 'samantha' }), pr(3, { author: 'lee' })];
  assert.deepEqual(filter(pullRequests, 'author:sam'), []);
  assert.deepEqual(filter(pullRequests, 'author:sam', { partial: 'author:sam' }), [1, 2]);
  assert.deepEqual(filter(pullRequests, 'author:lee,sam-', { partial: 'author:lee,sam-' }), [1, 3]);
});

test('qualifiers left to GitHub do not filter locally, and neither do tokens GitHub already applied', () => {
  const pullRequests = [pr(1), pr(2, { title: 'unrelated' })];
  assert.deepEqual(filter(pullRequests, 'involves:@me project:v2'), [1, 2]);
  const plan = search.planQuery('cart');
  assert.deepEqual(pullRequests.filter((pullRequest) => search.matchesAll(pullRequest, plan.filters, context({ handled: new Set(['cart']) }))).length, 2);
});

test('sorts by wait, newest, comments and update time', () => {
  const pullRequests = [pr(1, { comments: 5, updatedAt: '2026-10-01T00:00:00Z' }), pr(2, { comments: 1, updatedAt: '2026-10-05T00:00:00Z' }), pr(3)];
  const statusOf = (pullRequest) => ({ kind: 'awaiting', hours: { 1: 2, 2: 9, 3: 4 }[pullRequest.number] });
  assert.deepEqual(search.sortPullRequests(pullRequests, 'wait-desc', statusOf).map((entry) => entry.number), [2, 3, 1]);
  assert.deepEqual(search.sortPullRequests(pullRequests, 'created-desc', statusOf).map((entry) => entry.number), [3, 2, 1]);
  assert.deepEqual(search.sortPullRequests(pullRequests, 'comments-desc', statusOf).map((entry) => entry.number), [1, 2, 3]);
  assert.deepEqual(search.sortPullRequests(pullRequests, 'updated-desc', statusOf).map((entry) => entry.number), [2, 1, 3]);
});

test('facet counts apply every other filter but their own', () => {
  const pullRequests = [pr(1, { author: 'mira', labels: ['ui'] }), pr(2, { author: 'sam', labels: ['ui'] }), pr(3, { author: 'sam', labels: ['docs'] })];
  const plan = search.planQuery('author:mira label:ui');
  const authors = search.facetCounts(pullRequests, plan.filters, 'author', context());
  assert.deepEqual([...authors], [['mira', 1], ['sam', 1]]);
});

test('editing a query keeps the rest of it', () => {
  assert.equal(search.setValues('is:open author:mira fix', 'author', ['sam', 'lee park']), 'is:open fix author:sam,"lee park"');
  assert.equal(search.setValues('is:open author:mira -author:bot', 'author', []), 'is:open -author:bot');
  assert.equal(search.toggleToken('is:open is:unread', 'is', 'unread'), 'is:open');
  assert.equal(search.toggleToken('is:open', 'sla', 'breached'), 'is:open sla:breached');
  assert.equal(search.toggleToken('sla:breached,at-risk', 'sla', 'breached'), 'sla:at-risk');
  assert.equal(search.setStates('is:pr is:open label:ui', ['merged', 'closed']), 'is:closed label:ui');
  assert.equal(search.setStates('is:closed label:ui', ['open', 'merged', 'closed']), 'label:ui');
  assert.equal(search.setSort('is:open sort:updated-desc', 'created-desc'), 'is:open');
  assert.equal(search.clearFilters('is:open author:mira cart sort:comments-desc'), 'is:open sort:comments-desc');
  assert.deepEqual(search.selectedValues('author:mira,sam -author:lee', 'author'), ['mira', 'sam']);
});

test('rewrites one filter in place', () => {
  const text = 'is:open author:mira cart -label:docs fix';
  const tokens = search.tokenize(text);
  const author = tokens.find((token) => token.key === 'author');
  assert.equal(search.replaceTokens(text, [author.start], [search.formatToken('author', ['sam', 'lee park'], true)]), 'is:open -author:sam,"lee park" cart -label:docs fix');
  const words = tokens.filter((token) => token.key === null).map((token) => token.start);
  assert.equal(search.replaceTokens(text, words, [search.formatToken(null, ['cart totals'])]), 'is:open author:mira "cart totals" -label:docs');
  assert.equal(search.replaceTokens(text, [author.start], []), 'is:open cart -label:docs fix');
  assert.equal(search.replaceTokens(text, [], ['review:none']), 'is:open author:mira cart -label:docs fix review:none');
});

test('suggests qualifier names, then values from the loaded pull requests', () => {
  const keys = search.suggest('is:open au', 10, {});
  assert.deepEqual(keys.items.map((item) => item.insert), ['author:']);
  assert.equal(keys.start, 8);
  const people = search.suggest('author:s', 8, { author: ['mira', 'sam', 'lee-park'] });
  assert.deepEqual(people.items.map((item) => item.insert), ['author:sam ']);
  const more = search.suggest('-label:ui,', 10, { label: ['ui', 'docs', 'needs review'] });
  assert.deepEqual(more.items.map((item) => item.insert), ['-label:ui,docs ', '-label:ui,"needs review" ']);
  assert.deepEqual(search.suggest('review:ch', 9, {}).items.map((item) => item.label), ['changes_requested']);
  assert.equal(search.suggest('author:mira rest', 5, {}), null);
});
