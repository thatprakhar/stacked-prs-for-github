(function (root) {
  const { ListView, octicon, api, search, SearchBar, relativeTime } = root.GitHubStacks;
  const { element, avatar, separator, labelChip } = root.GitHubStacks.render;

  const PREVIEW_CHARACTERS = 300;
  const MAXIMUM_ASSIGNEES = 3;
  const ISSUE_SORTS = ['created-desc', 'created-asc', 'updated-desc', 'updated-asc', 'comments-desc'];
  const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
  // GitHub's issue type colors, as Primer's.
  const TYPE_COLORS = { GRAY: '59636e', BLUE: '0969da', GREEN: '1a7f37', YELLOW: '9a6700', ORANGE: 'bc4c00', RED: 'd1242f', PINK: 'bf3989', PURPLE: '8250df' };
  const PULL_REQUEST_STATE = { MERGED: 'merged', CLOSED: 'closed', OPEN: 'open' };

  // A line like "🗄️ Data Integrity | 🟠 Major | 🏗️ Heavy lift", as review bots start their issues with.
  function tagLine(line) {
    const parts = line.split('|').map((part) => part.trim());
    return parts.length >= 2 && parts.every((part) => part.length > 0 && part.length <= 40) ? parts : null;
  }

  // A title that is only an HTML comment, as some bots write, shows the description's first real line instead,
  // with a leading tag line shown as tags.
  function displayTitle(issue) {
    const title = (issue.title || '').replace(/<!--[\s\S]*?(-->|$)/g, '').trim();
    if (title) return { text: title, derived: false, tags: [], skip: [] };
    const lines = (issue.bodyText || '')
      .split('\n')
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    const tags = lines.length > 1 ? tagLine(lines[0]) : null;
    const line = tags ? lines[1] : lines[0];
    return { text: line || `Issue #${issue.number}`, derived: true, tags: tags || [], skip: [tags ? lines[0] : null, line].filter(Boolean) };
  }

  function descriptionPreview(issue, title) {
    let text = (issue.bodyText || '').replace(/\s+/g, ' ').trim();
    // Leaves out what the title already says.
    for (const used of [...title.skip, title.derived ? null : title.text].filter(Boolean)) {
      const flat = used.replace(/\s+/g, ' ');
      if (text.toLowerCase().startsWith(flat.toLowerCase())) text = text.slice(flat.length).replace(/^[\s.:–—-]+/, '');
    }
    if (text.length > PREVIEW_CHARACTERS) text = `${text.slice(0, PREVIEW_CHARACTERS).replace(/\s+\S*$/, '')}…`;
    return text;
  }

  function when(timestamp, now) {
    const milliseconds = Date.parse(timestamp);
    if (now - milliseconds < 30 * DAY_MILLISECONDS) return relativeTime(milliseconds, now);
    return `on ${new Date(milliseconds).toLocaleDateString([], { month: 'short', day: 'numeric', year: new Date(milliseconds).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })}`;
  }

  function issueIcon(issue) {
    if (issue.state !== 'CLOSED') return octicon('issue-opened', 'ghs-state ghs-state--open');
    if (issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE') return octicon('skip', 'ghs-state ghs-state--draft');
    return octicon('issue-closed', 'ghs-state ghs-state--merged');
  }

  function stateText(issue, now) {
    if (issue.state !== 'CLOSED') return null;
    const reason = issue.stateReason === 'NOT_PLANNED' ? ' as not planned' : issue.stateReason === 'DUPLICATE' ? ' as a duplicate' : '';
    return `closed ${issue.closedAt ? when(issue.closedAt, now) : ''}${reason}`.trim();
  }

  function pullRequestIcon(pullRequest) {
    const state = PULL_REQUEST_STATE[pullRequest.state] || 'open';
    if (state === 'merged') return octicon('git-merge', 'ghs-state ghs-state--merged');
    if (state === 'closed') return octicon('git-pull-request-closed', 'ghs-state ghs-state--closed');
    if (pullRequest.isDraft) return octicon('git-pull-request-draft', 'ghs-state ghs-state--draft');
    return octicon('git-pull-request', 'ghs-state ghs-state--open');
  }

  // The pull requests that close the issue: the furthest along links straight to it, the rest are in its tooltip.
  function linkedPullRequests(issue) {
    const references = issue.closedByPullRequestsReferences;
    const nodes = (references && references.nodes) || [];
    if (nodes.length === 0) return null;
    const best = nodes.find((node) => node.state === 'MERGED') || nodes.find((node) => node.state === 'OPEN' && !node.isDraft) || nodes.find((node) => node.state === 'OPEN') || nodes[0];
    const describe = (node) => `#${node.number} ${node.title} (${node.state === 'OPEN' && node.isDraft ? 'draft' : PULL_REQUEST_STATE[node.state] || 'open'})`;
    const title = `${references.totalCount === 1 ? 'Linked pull request' : `${references.totalCount} linked pull requests`}\n${nodes.map(describe).join('\n')}`;
    return element('a', { className: 'ghs-issue-linked', attributes: { href: best.url, title, 'aria-label': title } }, [pullRequestIcon(best), String(references.totalCount)]);
  }

  function subIssueProgress(issue) {
    const summary = issue.subIssuesSummary;
    if (!summary || !summary.total) return null;
    const title = `${summary.completed} of ${summary.total} sub-issues done`;
    return element('span', { className: `ghs-issue-subs${summary.completed === summary.total ? ' is-done' : ''}`, attributes: { title, 'aria-label': title } }, [
      octicon('issue-tracks'),
      element('span', { className: 'ghs-issue-progress', attributes: { 'aria-hidden': 'true' } }, element('span', { attributes: { style: `width:${summary.percentCompleted}%` } })),
      `${summary.completed}/${summary.total}`,
    ]);
  }

  function blockedBadge(issue) {
    const summary = issue.issueDependenciesSummary;
    if (!summary || !summary.blockedBy || issue.state === 'CLOSED') return null;
    const title = `Blocked by ${summary.blockedBy} open ${summary.blockedBy === 1 ? 'issue' : 'issues'}`;
    return element('span', { className: 'ghs-issue-blocked', attributes: { title } }, [octicon('blocked'), `Blocked by ${summary.blockedBy}`]);
  }

  function assigneeStack(issue) {
    const assignees = (issue.assignees && issue.assignees.nodes) || [];
    if (assignees.length === 0) return null;
    const names = assignees.map((assignee) => assignee.login).join(', ');
    return element('span', { className: 'ghs-issue-assignees', attributes: { title: `Assigned to ${names}`, 'aria-label': `Assigned to ${names}` } }, [
      ...assignees.slice(0, MAXIMUM_ASSIGNEES).map((assignee) => avatar(assignee, 20)),
      assignees.length > MAXIMUM_ASSIGNEES ? element('span', { className: 'ghs-issue-more', text: `+${assignees.length - MAXIMUM_ASSIGNEES}` }) : null,
    ]);
  }

  // Opens the issue from anywhere on its card that is not a link or button; ⌘ or Ctrl opens it in a new tab.
  function openOnClick(card, url) {
    card.addEventListener('click', (event) => {
      if (event.target.closest('a, button') || window.getSelection().toString()) return;
      if (event.metaKey || event.ctrlKey) window.open(url, '_blank');
      else location.assign(url);
    });
  }

  // One issue as a card: title and labels, the description, then who and when on the left and progress on the right.
  // The author is named in the meta line; the avatars on the right are only the assignees.
  function issueCard(issue, now) {
    const title = displayTitle(issue);
    const preview = descriptionPreview(issue, title);
    const labels = (issue.labels && issue.labels.nodes) || [];
    const comments = issue.comments ? issue.comments.totalCount : 0;
    const login = issue.author ? issue.author.login : 'ghost';
    const unread = issue.isReadByViewer === false;
    const closed = stateText(issue, now);
    const card = element('article', { className: `ghs-issue-card${unread ? ' is-unread' : ''}${issue.state === 'CLOSED' ? ' is-closed' : ''}`, attributes: { 'data-number': issue.number } }, [
      element('div', { className: 'ghs-issue-card-head' }, [
        element('span', { className: 'ghs-issue-card-icon' }, issueIcon(issue)),
        element('div', { className: 'ghs-issue-card-title' }, [
          unread ? element('span', { className: 'ghs-issue-unread', attributes: { title: 'Updated since you last viewed it', 'aria-label': 'Updated since you last viewed it' } }) : null,
          element('a', {
            className: `ghs-row-title${title.derived ? ' is-derived' : ''}`,
            text: title.text,
            attributes: { href: issue.url, 'data-turbo-frame': '_top', title: title.derived ? `From the description; the title on GitHub is ${issue.title}` : null },
          }),
          issue.issueType ? labelChip({ name: issue.issueType.name, color: TYPE_COLORS[issue.issueType.color] || TYPE_COLORS.GRAY }) : null,
          ...title.tags.map((tag) => element('span', { className: 'ghs-issue-tag', text: tag })),
          ...labels.map(labelChip),
        ]),
      ]),
      preview ? element('p', { className: 'ghs-issue-preview', text: preview }) : null,
      element('div', { className: 'ghs-issue-card-foot' }, [
        element('div', { className: 'ghs-meta' }, [
          `#${issue.number}`,
          separator(),
          element('span', { className: 'ghs-meta-author', text: login }),
          ` opened ${when(issue.createdAt, now)}`,
          closed ? separator() : null,
          closed,
          issue.milestone ? separator() : null,
          issue.milestone ? element('span', { className: 'ghs-issue-milestone' }, [octicon('milestone'), issue.milestone.title]) : null,
          issue.parent ? separator() : null,
          issue.parent ? element('a', { className: 'ghs-issue-parent', attributes: { href: issue.parent.url, title: issue.parent.title } }, [octicon('issue-tracks'), `Sub-issue of #${issue.parent.number}`]) : null,
          separator(),
          `updated ${when(issue.updatedAt, now)}`,
        ]),
        element('div', { className: 'ghs-issue-signals' }, [
          blockedBadge(issue),
          subIssueProgress(issue),
          linkedPullRequests(issue),
          comments > 0 ? element('a', { className: 'ghs-comments', attributes: { href: issue.url, title: `${comments} comments` } }, [octicon('comment'), String(comments)]) : null,
          assigneeStack(issue),
        ]),
      ]),
    ]);
    openOnClick(card, issue.url);
    return card;
  }

  // The issue list: the same search and loading as the pull request list, with issue cards that show the description.
  class IssueListView extends ListView {
    label() {
      return 'Issues';
    }

    noun() {
      return 'issues';
    }

    enabledKey() {
      return 'issueView';
    }

    createSearchBar() {
      return new SearchBar({ kind: 'issue' });
    }

    linkSegment() {
      return 'issues';
    }

    fetchItems(owner, repository, query, onPage) {
      return api.searchItems(owner, repository, query, { kind: 'issue', onPage });
    }

    fetchStacks() {
      return Promise.resolve([]);
    }

    fetchCounts(owner, repository, terms) {
      return api.countItems(owner, repository, terms, 'issue');
    }

    quickFilters(chip) {
      return [
        chip('unread', 'Updated', 'dot-fill', 'is', 'unread', 'Updated since you last viewed them (is:unread)'),
        this.viewer ? chip('assigned', 'Assigned to me', 'person', 'assignee', '@me', 'Assigned to you (assignee:@me)') : null,
        this.viewer ? chip('mine', 'Mine', 'person', 'author', '@me', 'Opened by you (author:@me)') : null,
        chip('unassigned', 'No assignee', 'dash', 'no', 'assignee', 'Nobody assigned (no:assignee)'),
        chip('linked', 'Has a pull request', 'git-pull-request', 'linked', 'pr', 'A pull request will close it (linked:pr)'),
      ];
    }

    sortChoices() {
      return ISSUE_SORTS;
    }

    computeView(result) {
      const plan = search.planQuery(this.fullQuery());
      const none = { kind: 'none' };
      const statusOf = () => none;
      const typing = this.typingToken();
      const context = { viewer: this.viewer, statusOf, isStacked: () => false, handled: this.request.handled, partial: typing ? typing.raw : null };
      const sorted = search.sortPullRequests(result.items, plan.sort, statusOf);
      const shown = sorted.filter((issue) => search.matchesAll(issue, plan.filters, context));
      return { result, plan, committed: this.committedFilters(), context, shown, matched: new Set(shown.map((issue) => issue.number)), refining: plan.refining, options: new Map(), vocabulary: null };
    }

    renderResults(view, errorNotice) {
      const { result, shown, matched } = view;
      const now = Date.now();
      const list = element('div', { className: 'ghs-list ghs-issue-cards', attributes: { role: 'list' } });
      for (const issue of shown) list.append(element('div', { className: 'ghs-issue-entry', attributes: { role: 'listitem' } }, issueCard(issue, now)));
      if (!list.firstChild) list.append(this.renderEmpty(view));
      const total = result.items.length;
      const toolbar = element('div', { className: 'ghs-toolbar' }, [
        element('div', { className: 'ghs-toolbar-title' }, [
          octicon('issue-opened'),
          'Issues',
          element('span', { className: 'ghs-counter', text: matched.size === total ? String(total) : `${matched.size} of ${total}`, attributes: { title: `${matched.size} of the ${total} loaded issues match` } }),
        ]),
        element('div', { className: 'ghs-actions' }, [
          this.iconButton('Refresh', 'sync', () => (this.stale ? location.reload() : this.load({ quiet: true })), this.loading ? 'is-spinning' : ''),
          this.iconButton('Settings', 'gear', () => api.openOptions()),
          this.iconButton('Show the GitHub list', 'list-unordered', () => this.setEnabled(false)),
        ]),
      ]);
      return [this.stale ? this.renderStaleNotice() : null, errorNotice, toolbar, list, this.renderFooter(result)].filter(Boolean);
    }

    renderCollapsedBar() {
      return element('div', { className: 'ghs-toolbar ghs-toolbar--slim' }, [
        element('div', { className: 'ghs-toolbar-title' }, [octicon('issue-opened'), 'Issue view is off']),
        element('div', { className: 'ghs-actions' }, [this.button('Show issue view', () => this.setEnabled(true), 'issue-opened')]),
      ]);
    }

    vocabulary(items) {
      const base = super.vocabulary(items);
      const types = new Map();
      const milestones = new Set();
      for (const item of items) {
        if (item.issueType) types.set(item.issueType.name, TYPE_COLORS[item.issueType.color] || TYPE_COLORS.GRAY);
        if (item.milestone) milestones.add(item.milestone.title);
      }
      return {
        ...base,
        type: [...types].map(([value, color]) => ({ value, color })),
        milestone: [...milestones].sort().map((value) => ({ value })),
      };
    }

    options(key) {
      const view = this.view;
      if (!view) return [];
      if (!['is', 'no', 'type', 'milestone', 'linked', 'reason'].includes(key)) return super.options(key);
      if (view.options.has(key)) return view.options.get(key);
      const { result, context } = view;
      const facets = search.FACET_KEYS.has(key) ? search.facetCounts(result.items, view.committed, key, context) : null;
      const counts = facets ? new Map([...facets].map(([value, count]) => [String(value).toLowerCase(), count])) : null;
      const count = (value) => (counts ? counts.get(value.toLowerCase()) || 0 : undefined);
      const vocabulary = view.vocabulary || (view.vocabulary = this.vocabulary(result.items));
      const fixed = (entries) => entries.map(([value, label, icon]) => ({ value, label, icon, count: count(value) }));
      let options;
      switch (key) {
        case 'is':
          options = fixed([['unread', 'Updated since you viewed it', 'dot-fill']]);
          break;
        case 'no':
          options = fixed([['label', 'Label', 'tag'], ['assignee', 'Assignee', 'person'], ['milestone', 'Milestone', 'milestone']]);
          break;
        case 'linked':
          options = fixed([['pr', 'Linked pull request', 'git-pull-request']]);
          break;
        case 'reason':
          options = [
            { value: 'completed', label: 'Completed', icon: 'issue-closed' },
            { value: 'not planned', label: 'Not planned', icon: 'skip' },
          ];
          break;
        case 'type':
          options = vocabulary.type.map((type) => ({ value: type.value, label: type.value, color: type.color, count: count(type.value) }));
          break;
        default:
          options = vocabulary.milestone.map((milestone) => ({ value: milestone.value, label: milestone.value, icon: 'milestone', count: count(milestone.value) }));
      }
      if (key === 'type' || key === 'milestone') options.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
      view.options.set(key, options);
      return options;
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { IssueListView });
})(globalThis);
