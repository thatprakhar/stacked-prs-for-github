(function (root) {
  const { octicon, api, reviewStatus, groupPullRequests, search, SearchBar } = root.GitHubStacks;
  const { element, statusPill, stateIcon, pullRequestState, pullRequestRow, separator, isUnread, unreadMarker, LEVEL_TEXT, LEVEL_TONE } = root.GitHubStacks.render;

  const REFRESH_MILLISECONDS = 3 * 60 * 1000;
  const REFRESH_ON_RETURN_MILLISECONDS = 30 * 1000;
  const LEVELS = ['breached', 'at_risk', 'on_track'];
  const PAGINATION_SELECTOR = 'nav[aria-label="Pagination"], nav[aria-label="pagination"], .paginate-container, [data-testid="pagination"]';
  const NOTHING = { key: 'none', handled: new Set() };
  const REVIEW_LABELS = { none: 'Not reviewed', approved: 'Approved', changes_requested: 'Changes requested', 're-requested': 'Re-review requested', commented: 'Commented', 'bot-approved': 'Bot approved', required: 'Review required' };

  // segment: 'pull' for the pull request list, 'issues' for the issue list.
  function findNativeList(route, ownRoot, segment = 'pull') {
    const pattern = new RegExp(`^/${route.owner}/${route.repository}/${segment}/\\d+/?$`, 'i');
    const links = [...document.querySelectorAll(`a[href*="/${segment}/"]`)].filter((link) => {
      if (ownRoot.contains(link) || link.closest('.ghs-navigator, .ghs-floating, [aria-label*="pinned" i]')) return false;
      try {
        return pattern.test(new URL(link.href, location.href).pathname);
      } catch {
        return false;
      }
    });
    if (links.length === 0) return null;
    // The list is the one holding the most rows that link to items; pinned issues and mentions sit elsewhere.
    const lists = new Map();
    for (const link of links) {
      const row = link.closest('li, [role="listitem"], [role="row"], .js-issue-row');
      if (row && row.parentElement) lists.set(row.parentElement, (lists.get(row.parentElement) || 0) + 1);
    }
    if (lists.size > 0) return [...lists].sort((left, right) => right[1] - left[1])[0][0];
    const numbers = new Set(links.map((link) => new URL(link.href, location.href).pathname.split('/')[4]));
    let container = links[0];
    if (numbers.size === 1) {
      const row = links[0].closest('li, [role="listitem"], [role="row"], .js-issue-row');
      return row ? row.parentElement : links[0].parentElement && links[0].parentElement.parentElement;
    }
    for (const link of links) {
      while (container && !container.contains(link)) container = container.parentElement;
    }
    return container && container !== document.body ? container : null;
  }

  function nativeSearchInput(ownRoot) {
    return [...document.querySelectorAll('input')].find(
      (candidate) =>
        !ownRoot.contains(candidate) &&
        !candidate.closest('.ghs-floating') &&
        (/(^|\s)(is|state):(pr|issue|open|closed|merged)(\s|$)/.test(candidate.value) || /pulls.*filter|issues.*filter|issues-search/i.test(candidate.id)),
    );
  }

  // GitHub's own search box, and everything between it and the list (Open/Closed, the filter menus, sort), which
  // the extension's search replaces. Found by role and position rather than class names, which GitHub changes.
  function nativeSearchChrome(native, ownRoot) {
    const chrome = [];
    const input = nativeSearchInput(ownRoot);
    const box = input && input.closest('[role="search"], form');
    if (box && !box.contains(native) && !box.contains(ownRoot)) chrome.push(box);
    for (let sibling = native.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling === ownRoot || sibling.contains(ownRoot) || /^H[1-6]$/.test(sibling.tagName)) continue;
      chrome.push(sibling);
    }
    return chrome;
  }

  // GitHub writes is:pr (or is:issue) into its queries; the page already says which, so it is left out.
  function tidy(text) {
    return search
      .tokenize(text)
      .filter((token) => search.classify(token) !== 'ignore')
      .map((token) => token.raw)
      .join(' ');
  }

  function urlQuery() {
    return new URLSearchParams(location.search).get('q');
  }

  function initialQuery(ownRoot) {
    const fromUrl = urlQuery();
    if (fromUrl !== null) return tidy(fromUrl);
    const input = nativeSearchInput(ownRoot);
    return input ? tidy(input.value) : search.DEFAULT_QUERY;
  }

  function formatNumber(count) {
    return count.toLocaleString();
  }

  class ListView {
    constructor() {
      this.root = element('section', { className: 'ghs-root', attributes: { 'aria-label': this.label() } });
      this.searchBar = this.createSearchBar();
      this.body = element('div', { className: 'ghs-body' });
      this.root.append(this.searchBar.node, this.body);
      this.native = null;
      this.chrome = [];
      this.key = null;
      this.query = search.DEFAULT_QUERY;
      this.draft = '';
      this.request = NOTHING;
      this.cache = new Map();
      this.completeScopes = new Map();
      this.counts = new Map();
      this.stacks = null;
      this.settings = null;
      this.viewer = null;
      this.shown = null;
      this.error = null;
      this.loading = false;
      this.enabled = true;
      this.expanded = new Set();
      this.revealed = new Set();
      this.ready = Promise.all([api.readLocal(this.enabledKey(), true), api.readLocal('expandedStacks', [])]).then(([enabled, expanded]) => {
        this.enabled = enabled;
        this.expanded = new Set(expanded);
      });
      setInterval(() => this.tick(), 60 * 1000);
      document.addEventListener('visibilitychange', () => this.tick(REFRESH_ON_RETURN_MILLISECONDS));
    }

    // What differs between the pull request list and the issue list; IssueListView overrides these.
    label() {
      return 'Stacked pull requests';
    }

    noun() {
      return 'pull requests';
    }

    enabledKey() {
      return 'stackedView';
    }

    createSearchBar() {
      return new SearchBar();
    }

    linkSegment() {
      return 'pull';
    }

    fetchItems(owner, repository, query, onPage) {
      return api.searchItems(owner, repository, query, { kind: 'pull_request', onPage });
    }

    fetchStacks(owner, repository) {
      return api.listStacks(owner, repository);
    }

    fetchCounts(owner, repository, terms) {
      return api.countItems(owner, repository, terms, 'pull_request');
    }

    sync(route) {
      this.route = route;
      const key = `${route.host}/${route.owner}/${route.repository}`;
      const native = findNativeList(route, this.root, this.linkSegment());
      if (native) {
        if (this.native && this.native !== native) this.native.classList.remove('ghs-native-hidden');
        if (this.native !== native || this.chrome.some((node) => !node.isConnected)) {
          this.showChrome();
          this.chrome = [];
        }
        this.native = native;
        if (!this.root.isConnected || this.root.parentElement !== native.parentElement) native.before(this.root);
        if (this.chrome.length === 0) this.chrome = nativeSearchChrome(native, this.root);
      } else if (!this.root.isConnected || key !== this.key) {
        // GitHub's list can empty out under a query with no results; keep ours, which has its own search.
        this.unmount();
        return;
      }

      if (key !== this.key) this.reset(key);
      else {
        const fromUrl = urlQuery();
        if (fromUrl !== null && fromUrl !== this.urlQuery && fromUrl !== this.query.trim()) {
          // GitHub navigated, for example from its sidebar's "Review requests".
          this.urlQuery = fromUrl;
          this.setQuery(tidy(fromUrl), { commit: true, writeUrl: false });
        }
      }
      this.applyNativeVisibility();
    }

    reset(key) {
      this.key = key;
      this.cache = new Map();
      this.completeScopes = new Map();
      this.counts = new Map();
      this.stacks = null;
      this.shown = null;
      this.error = null;
      this.revealed = new Set();
      this.request = NOTHING;
      this.query = initialQuery(this.root);
      this.draft = '';
      this.urlQuery = urlQuery();
      api.settings().then((settings) => {
        if (!this.settings) {
          this.settings = settings;
          this.render();
        }
      }, () => {});
      this.commit();
    }

    unmount() {
      if (!this.root.isConnected && !this.native) return;
      this.searchBar.close();
      this.root.remove();
      if (this.native) this.native.classList.remove('ghs-native-hidden');
      this.showChrome();
      for (const pagination of document.querySelectorAll(PAGINATION_SELECTOR)) pagination.classList.remove('ghs-native-hidden');
      this.native = null;
      this.chrome = [];
      this.key = null;
    }

    showChrome() {
      for (const node of this.chrome) node.classList.remove('ghs-native-hidden');
    }

    applyNativeVisibility() {
      const hide = this.enabled && Boolean(this.result()) && !this.error;
      for (const node of [this.native, ...this.chrome, ...document.querySelectorAll(PAGINATION_SELECTOR)]) {
        if (node && node.classList.contains('ghs-native-hidden') !== hide) node.classList.toggle('ghs-native-hidden', hide);
      }
    }

    // What to load for a query: the pull requests in its states (and GitHub-only qualifiers), all of them when they
    // fit, so every other filter applies instantly here. When there are more than fit, its words and qualifiers are
    // sent to GitHub too, so the search covers all of them.
    target(plan) {
      if (plan.scopeQuery === null) return NOTHING;
      const complete = this.completeScopes.get(plan.scopeQuery);
      if (complete) return { key: complete, query: plan.scopeQuery, sort: this.cache.get(complete).sort, handled: new Set(), githubTerms: plan.githubTerms };
      const scopeKey = `${plan.scopeQuery}\n${plan.serverSort}`;
      const scope = this.cache.get(scopeKey);
      if (scope && scope.truncated && plan.deepTerms.length > 0) {
        const query = `${plan.scopeQuery} ${plan.deepTerms.join(' ')}`.trim();
        return { key: `${query}\n${plan.serverSort}`, query, sort: plan.serverSort, handled: new Set(plan.deepTerms), githubTerms: plan.githubTerms, deep: true, scopeTotal: scope.total };
      }
      return { key: scopeKey, query: plan.scopeQuery, sort: plan.serverSort, handled: new Set(), githubTerms: plan.githubTerms };
    }

    fresh(key, maximumAge = REFRESH_MILLISECONDS) {
      const cached = this.cache.get(key);
      return Boolean(cached) && Date.now() - cached.fetchedAt < maximumAge;
    }

    setQuery(query, { commit = false, writeUrl = true } = {}) {
      const changed = query !== this.query;
      this.query = query;
      if (writeUrl && changed) this.writeUrl();
      const next = this.target(search.planQuery(query));
      // Already loaded: switch at once, no need to press Enter.
      if (next.key !== this.request.key && (next.key === NOTHING.key || this.fresh(next.key))) this.request = next;
      if (commit) this.commit();
      else this.render();
    }

    writeUrl() {
      const url = new URL(location.href);
      const query = this.query.trim();
      if (url.searchParams.get('q') === query) return;
      url.searchParams.set('q', query);
      history.replaceState(history.state, '', url);
      this.urlQuery = query;
    }

    commit() {
      const next = this.target(search.planQuery(this.query));
      const changed = next.key !== this.request.key;
      this.request = next;
      if (changed) this.error = null;
      if (next.key === NOTHING.key || (this.fresh(next.key) && this.stacks)) this.render();
      else if (changed || !this.loading) this.load();
      else this.render();
    }

    pendingTarget() {
      const next = this.target(search.planQuery(this.query));
      return next.key === this.request.key ? null : next;
    }

    result() {
      if (this.request.key === NOTHING.key) return { items: [], total: 0, truncated: false, fetchedAt: Date.now() };
      return this.cache.get(this.request.key) || this.shown;
    }

    tick(maximumAge = REFRESH_MILLISECONDS) {
      if (!this.root.isConnected || document.visibilityState !== 'visible' || !this.result()) return;
      if (!api.extensionAlive()) {
        if (!this.stale) {
          this.stale = true;
          this.render();
        }
        return;
      }
      if (this.request.key !== NOTHING.key && !this.fresh(this.request.key, maximumAge)) this.load({ quiet: true });
      else this.render();
    }

    async load({ quiet = false } = {}) {
      const key = this.key;
      const request = this.request;
      if (request.key === NOTHING.key) return;
      const { owner, repository } = this.route;
      const countsKey = request.githubTerms.join(' ');
      this.loading = true;
      if (!quiet) this.render();
      try {
        await this.ready;
        const [settings, result, stacks, counts] = await Promise.all([
          api.settings(),
          this.fetchItems(owner, repository, `${request.query} sort:${request.sort}`, (partial) => {
            if (key !== this.key) return;
            this.cache.set(request.key, { ...partial, sort: request.sort, truncated: true, partial: true, fetchedAt: Date.now() });
            this.viewer = partial.viewer || this.viewer;
            if (request.key === this.request.key) this.render();
          }),
          this.stacks && !quiet ? this.stacks : this.fetchStacks(owner, repository),
          this.counts.has(countsKey) && !quiet ? this.counts.get(countsKey) : this.fetchCounts(owner, repository, countsKey).catch(() => null),
        ]);
        if (key !== this.key) return;
        const truncated = result.total > result.items.length;
        this.cache.set(request.key, { ...result, sort: request.sort, truncated, fetchedAt: Date.now() });
        if (!truncated && !request.deep) this.completeScopes.set(request.query, request.key);
        if (counts) this.counts.set(countsKey, counts);
        this.settings = settings;
        this.stacks = stacks;
        this.viewer = result.viewer || this.viewer;
        this.error = null;
      } catch (error) {
        if (key !== this.key) return;
        if (error.code === api.CONTEXT_INVALIDATED && this.result()) this.stale = true;
        else if (request.key === this.request.key) this.error = error;
      } finally {
        if (key === this.key && request.key === this.request.key) {
          this.loading = false;
          const loaded = this.cache.get(request.key);
          if (loaded && loaded.partial && this.error) this.cache.delete(request.key);
          // There were more than fit: search the rest on GitHub with the words and qualifiers typed.
          const next = this.target(search.planQuery(this.query));
          if (next.deep && next.key !== request.key && !this.error) {
            this.request = next;
            this.load({ quiet: true });
          }
          this.render();
          this.applyNativeVisibility();
        }
      }
    }

    async setEnabled(enabled) {
      this.enabled = enabled;
      await api.writeLocal({ [this.enabledKey()]: enabled });
      if (!enabled) {
        // Hand the query to GitHub's own list, which only reads it when the page loads.
        const input = nativeSearchInput(this.root);
        if (input && tidy(input.value) !== tidy(this.query)) {
          location.reload();
          return;
        }
      }
      this.render();
      this.applyNativeVisibility();
    }

    stackStorageKey(stack) {
      return `${this.route.host}/${this.route.owner}/${this.route.repository}:${stack.key}`;
    }

    toggleStack(stack, expanded) {
      const key = this.stackStorageKey(stack);
      if (expanded) this.expanded.add(key);
      else this.expanded.delete(key);
      api.writeLocal({ expandedStacks: [...this.expanded].slice(-200) });
      this.render();
    }

    render() {
      root.GitHubStacks.render.setViewer(this.viewer);
      if (!this.enabled) {
        this.searchBar.close();
        this.searchBar.node.hidden = true;
        this.body.replaceChildren(this.renderCollapsedBar());
        return;
      }
      const content = this.renderContent();
      this.searchBar.node.hidden = !this.view;
      if (this.view) this.searchBar.update(this.searchModel());
      else this.searchBar.close();
      this.body.replaceChildren(...content);
      // Still showing the previous results while the new ones load.
      this.body.classList.toggle('is-loading', this.request.key !== NOTHING.key && !this.cache.has(this.request.key) && Boolean(this.result()));
    }

    renderCollapsedBar() {
      return element('div', { className: 'ghs-toolbar ghs-toolbar--slim' }, [
        element('div', { className: 'ghs-toolbar-title' }, [octicon('stack'), 'Stacked view is off']),
        element('div', { className: 'ghs-actions' }, [this.button('Show stacked view', () => this.setEnabled(true), 'stack')]),
      ]);
    }

    button(text, onClick, icon, extraClass = '') {
      const node = element('button', { className: `ghs-button ${extraClass}`.trim(), attributes: { type: 'button' } }, [icon ? octicon(icon) : null, text]);
      node.addEventListener('click', onClick);
      return node;
    }

    iconButton(label, icon, onClick, extraClass = '') {
      const node = element('button', { className: `ghs-icon-button ${extraClass}`.trim(), attributes: { type: 'button', 'aria-label': label, title: label } }, octicon(icon));
      node.addEventListener('click', onClick);
      return node;
    }

    renderMessage(message, actions) {
      return element('div', { className: 'ghs-message' }, [element('div', { className: 'ghs-message-text' }, message), element('div', { className: 'ghs-actions' }, actions)]);
    }

    renderStaleNotice() {
      return element('div', { className: 'ghs-notice', attributes: { role: 'status' } }, [
        element('span', {}, [octicon('sync'), ' Stacked PRs for GitHub was updated. Refresh the page for the new version and live data.']),
        this.button('Refresh page', () => location.reload(), null, 'ghs-button--small'),
      ]);
    }

    // Everything the list and the search bar show for the current query, computed once per render.
    computeView(result) {
      const settings = this.settings;
      const now = Date.now();
      const plan = search.planQuery(this.fullQuery());
      const statuses = new Map(result.items.map((pullRequest) => [pullRequest.number, reviewStatus(pullRequest, now, settings)]));
      const statusOf = (pullRequest) => statuses.get(pullRequest.number);
      const sorted = search.sortPullRequests(result.items, plan.sort, statusOf);
      const entries = groupPullRequests(sorted, this.stacks || []);
      const stacked = new Set();
      for (const entry of entries) {
        if (entry.type === 'stack') for (const row of entry.rows) stacked.add(row.pullRequest.number);
        else if (entry.stack) stacked.add(entry.pullRequest.number);
      }
      const typing = this.typingToken();
      const context = { viewer: this.viewer, statusOf, isStacked: (pullRequest) => stacked.has(pullRequest.number), handled: this.request.handled, partial: typing ? typing.raw : null };
      const matched = new Set(result.items.filter((pullRequest) => search.matchesAll(pullRequest, plan.filters, context)).map((pullRequest) => pullRequest.number));
      const rank = new Map(sorted.map((pullRequest, index) => [pullRequest.number, index]));
      const visible = [];
      for (const entry of entries) {
        const rows = entry.type === 'stack' ? entry.rows.filter((row) => matched.has(row.pullRequest.number)) : matched.has(entry.pullRequest.number) ? [entry] : [];
        if (rows.length === 0) continue;
        visible.push({ entry, rows, rank: Math.min(...rows.map((row) => rank.get(row.pullRequest.number))) });
      }
      visible.sort((left, right) => left.rank - right.rank);
      return { result, plan, committed: this.committedFilters(), statuses, context, entries, visible, matched, refining: plan.refining, options: new Map(), vocabulary: null };
    }

    renderContent() {
      this.view = null;
      if (this.error && this.error.code === api.CONTEXT_INVALIDATED) {
        return [this.renderMessage([octicon('sync'), ' Stacked PRs for GitHub was updated. Refresh the page to use it.'], [this.button('Refresh page', () => location.reload(), 'sync', 'ghs-button--primary')])];
      }
      const needsToken = this.error && (this.error.code === 'no_token' || this.error.code === 'bad_token');
      // A failed load with results already on screen keeps them, and the search, under a notice.
      const errorNotice = this.error && !needsToken && this.result() && this.settings ? this.renderErrorNotice() : null;
      if (this.error && !errorNotice) {
        return [
          this.renderMessage(
            needsToken
              ? [octicon('stack'), ` ${this.error.code === 'no_token' ? 'Add' : 'Replace'} the GitHub token for ${this.route.host} to see ${this.label().toLowerCase()}.`]
              : [octicon('x'), ` Could not load ${this.label().toLowerCase()}: ${this.error.message}`],
            needsToken
              ? [this.button(this.error.code === 'no_token' ? 'Add a token' : 'Replace the token', () => api.openOptions(), 'gear', 'ghs-button--primary'), this.iconButton('Turn off stacked view', 'x', () => this.setEnabled(false))]
              : [this.button('Retry', () => this.load(), 'sync'), this.iconButton('Turn off stacked view', 'x', () => this.setEnabled(false))],
          ),
        ];
      }
      const result = this.result();
      if (!result || !this.settings) {
        return [this.renderMessage([element('span', { className: 'ghs-spinner', attributes: { 'aria-hidden': 'true' } }), ` Loading ${this.label().toLowerCase()}…`], [])];
      }
      if (result !== this.shown && this.cache.get(this.request.key) === result) this.shown = result;

      const view = this.computeView(result);
      this.view = view;
      return this.renderResults(view, errorNotice);
    }

    // The toolbar, list and footer for loaded results.
    renderResults(view, errorNotice) {
      const { result } = view;
      const { settings } = this;
      const { statuses, visible, matched, refining, entries } = view;

      const list = element('div', { className: 'ghs-list', attributes: { role: 'list' } });
      for (const { entry, rows } of visible) {
        if (entry.type === 'single') {
          list.append(
            element('div', { className: 'ghs-entry', attributes: { role: 'listitem' } }, pullRequestRow(entry.pullRequest, statuses.get(entry.pullRequest.number), { stack: entry.stack, position: entry.position, standalone: true })),
          );
        } else list.append(this.renderStack(entry, rows, statuses, refining));
      }
      if (!list.firstChild) list.append(this.renderEmpty(view));

      const stackCount = visible.filter(({ entry }) => entry.type === 'stack').length;
      const slaCounts = search.facetCounts(result.items, view.plan.filters, 'sla', view.context);
      const total = result.items.length;
      const toolbar = element('div', { className: 'ghs-toolbar' }, [
        element('div', { className: 'ghs-toolbar-title' }, [
          octicon('stack'),
          'Stacked view',
          element('span', { className: 'ghs-counter', text: matched.size === total ? String(total) : `${matched.size} of ${total}`, attributes: { title: `${matched.size} of the ${total} loaded pull requests match` } }),
          stackCount > 0 ? element('span', { className: 'ghs-toolbar-note', text: `${stackCount} ${stackCount === 1 ? 'stack' : 'stacks'}` }) : null,
        ]),
        element(
          'div',
          { className: 'ghs-summary', attributes: { role: 'group', 'aria-label': 'Filter by review SLA' } },
          LEVELS.map((level) => {
            const value = level.replace('_', '-');
            const pressed = search.hasToken(this.query, 'sla', value);
            const chip = element(
              'button',
              {
                className: `ghs-pill ghs-pill--${LEVEL_TONE[level]} ghs-pill--button${pressed ? ' is-pressed' : ''}`,
                attributes: { type: 'button', 'aria-pressed': String(pressed), title: `${pressed ? 'Stop showing only' : 'Show only'} pull requests that are ${LEVEL_TEXT[level].toLowerCase()} (sla:${value})` },
              },
              [`${LEVEL_TEXT[level]}: `, element('span', { className: 'ghs-pill-hours', text: String(slaCounts.get(value) || 0) })],
            );
            chip.addEventListener('click', () => this.setQuery(search.toggleToken(this.query, 'sla', value), { commit: true }));
            return chip;
          }),
        ),
        element('div', { className: 'ghs-actions' }, [
          stackCount > 0 && !refining ? this.button(this.allExpanded(entries) ? 'Collapse all' : 'Expand all', () => this.toggleAll(entries), null, 'ghs-button--small') : null,
          this.iconButton('Refresh', 'sync', () => (this.stale ? location.reload() : this.load({ quiet: true })), this.loading ? 'is-spinning' : ''),
          this.iconButton('Settings', 'gear', () => api.openOptions()),
          this.iconButton('Show the GitHub list', 'list-unordered', () => this.setEnabled(false)),
        ]),
      ]);

      const workdays = settings.workdays.length === 5 && settings.workdays.every((day, index) => day === index + 1) ? 'Mon–Fri' : `${settings.workdays.length} days a week`;
      const footer = this.renderFooter(result, [
        `SLA ${settings.slaHours} work hours, at risk after ${settings.atRiskHours}`,
        separator(),
        `${workdays} ${settings.workdayStart}:00–${settings.workdayEnd}:00 ${settings.timeZone}`,
      ]);
      return [this.stale ? this.renderStaleNotice() : null, errorNotice, toolbar, list, footer].filter(Boolean);
    }

    // How much loaded, then notes such as the SLA settings, then when it was fetched.
    renderFooter(result, notes = []) {
      const total = result.items.length;
      const updated = new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return element('div', { className: 'ghs-footer' }, [
        result.partial
          ? element('span', {}, [element('span', { className: 'ghs-spinner ghs-spinner--small', attributes: { 'aria-hidden': 'true' } }), ` Loaded ${formatNumber(total)} of ${formatNumber(result.total)}, loading more…`])
          : result.incomplete
            ? `Showing ${formatNumber(total)} of ${formatNumber(result.total)}; GitHub did not answer for the rest`
            : result.truncated
              ? `Showing the first ${formatNumber(total)} of ${formatNumber(result.total)}${this.request.deep ? ' found on GitHub' : ''}`
              : `${formatNumber(result.total)} ${this.noun()}${this.request.deep ? ' found on GitHub' : ''}`,
        separator(),
        ...notes,
        notes.length > 0 ? separator() : null,
        `Updated ${updated}`,
      ]);
    }

    renderErrorNotice() {
      return element('div', { className: 'ghs-notice', attributes: { role: 'alert' } }, [
        element('span', {}, [octicon('x'), ` Could not load this search from GitHub: ${this.error.message}`]),
        this.button('Retry', () => this.load(), 'sync', 'ghs-button--small'),
      ]);
    }

    renderEmpty(view) {
      const pending = this.pendingTarget();
      const { result } = view;
      const lines = [element('div', { className: 'ghs-empty-title', text: view.refining || view.result.items.length > 0 ? `No ${this.noun()} match this search.` : `No ${this.noun()} here.` })];
      if (pending && pending.deep) lines.push(element('div', { text: `Only the ${formatNumber(result.items.length)} loaded of ${formatNumber(pending.scopeTotal)} were searched. Press Enter to search all of them on GitHub.` }));
      else if (pending) lines.push(element('div', { text: 'Press Enter to run this search.' }));
      const actions = [];
      if (pending) actions.push(this.button('Search GitHub', () => this.commit(), 'search', 'ghs-button--small'));
      if (view.refining) {
        actions.push(
          this.button('Clear filters', () => {
            this.draft = '';
            this.setQuery(search.clearFilters(this.query), { commit: true });
          }, 'x', 'ghs-button--small'),
        );
      }
      return element('div', { className: 'ghs-empty' }, [...lines, actions.length > 0 ? element('div', { className: 'ghs-empty-actions' }, actions) : null]);
    }

    // People, labels and branches of the loaded pull requests, for the menus and autocomplete.
    vocabulary(pullRequests) {
      const people = new Map();
      const addPerson = (actor) => {
        if (actor && actor.login && !people.has(actor.login)) people.set(actor.login, { value: actor.login, avatarUrl: actor.avatarUrl || null });
      };
      const labels = new Map();
      const branches = new Set();
      for (const pullRequest of pullRequests) {
        addPerson(pullRequest.author);
        for (const assignee of (pullRequest.assignees && pullRequest.assignees.nodes) || []) addPerson(assignee);
        for (const review of (pullRequest.reviews && pullRequest.reviews.nodes) || []) addPerson(review.author);
        for (const request of (pullRequest.reviewRequests && pullRequest.reviewRequests.nodes) || []) addPerson(request.requestedReviewer);
        for (const label of (pullRequest.labels && pullRequest.labels.nodes) || []) labels.set(label.name, { value: label.name, color: label.color });
        branches.add(pullRequest.headRefName);
        branches.add(pullRequest.baseRefName);
      }
      const me = this.viewer ? [{ value: '@me', detail: `You (${this.viewer})` }] : [];
      const everyone = [...me, ...[...people.values()].sort((left, right) => left.value.localeCompare(right.value))];
      const authors = [...me, ...[...new Map(pullRequests.filter((entry) => entry.author).map((entry) => [entry.author.login, { value: entry.author.login, avatarUrl: entry.author.avatarUrl }])).values()]];
      const branchList = [...branches].filter(Boolean).sort();
      return {
        author: authors,
        assignee: everyone,
        'review-requested': everyone,
        'user-review-requested': everyone,
        'reviewed-by': everyone,
        label: [...labels.values()].sort((left, right) => left.value.localeCompare(right.value)),
        head: branchList,
        base: branchList,
      };
    }

    // The values a filter can take, with how many loaded pull requests each would show given the other filters.
    options(key) {
      const view = this.view;
      if (!view) return [];
      if (view.options.has(key)) return view.options.get(key);
      const { result, context } = view;
      const pullRequests = result.items;
      const facets = search.FACET_KEYS.has(key) ? search.facetCounts(pullRequests, view.committed, key, context) : null;
      const counts = facets ? new Map([...facets].map(([value, count]) => [String(value).toLowerCase(), count])) : null;
      const count = (value) => (counts ? counts.get(value.toLowerCase()) || 0 : undefined);
      const vocabulary = view.vocabulary || (view.vocabulary = this.vocabulary(pullRequests));
      const fixed = (entries) => entries.map(([value, label, extra = {}]) => ({ value, label, count: count(value), ...extra }));
      let options;
      switch (key) {
        case 'review':
          options = fixed(search.VALUES.review.map(([value, detail]) => [value, REVIEW_LABELS[value], { detail: detail === REVIEW_LABELS[value] ? undefined : detail }]));
          break;
        case 'sla':
          options = fixed([['breached', 'SLA breached', { color: 'd1242f' }], ['at-risk', 'At risk', { color: 'bf8700' }], ['on-track', 'On track', { color: '1a7f37' }]]);
          break;
        case 'status':
          options = fixed([['success', 'Passing', { icon: 'check' }], ['failure', 'Failing', { icon: 'x' }], ['pending', 'Running', { icon: 'dot-fill' }]]);
          break;
        case 'is':
          options = fixed([['draft', 'Draft', { icon: 'git-pull-request-draft' }], ['unread', 'Updated since you viewed it', { icon: 'dot-fill' }], ['stacked', 'In a stack', { icon: 'stack' }]]);
          break;
        case 'no':
          options = fixed([['label', 'Label', { icon: 'tag' }], ['assignee', 'Assignee', { icon: 'person' }], ['review-requested', 'Review request', { icon: 'eye' }]]);
          break;
        case 'label':
          options = vocabulary.label.map((label) => ({ value: label.value, label: label.value, color: label.color || 'd1d9e0', count: count(label.value) }));
          break;
        case 'head':
        case 'base':
          options = vocabulary.head.map((branch) => ({ value: branch, label: branch, icon: 'git-branch', count: count(branch) }));
          break;
        default: {
          const people = (key === 'author' ? vocabulary.author : vocabulary.assignee).filter((person) => person.value !== '@me');
          const viewer = this.viewer ? people.find((person) => person.value === this.viewer) : null;
          options = [
            ...(this.viewer ? [{ value: '@me', label: 'You', detail: this.viewer, avatarUrl: viewer ? viewer.avatarUrl || null : null, count: count(this.viewer) }] : []),
            ...people.filter((person) => person.value !== this.viewer).map((person) => ({ value: person.value, label: person.value, avatarUrl: person.avatarUrl || null, count: count(person.value) })),
          ];
        }
      }
      if (counts && !['review', 'sla', 'status', 'is', 'no'].includes(key)) {
        options.sort((left, right) => (right.value === '@me') - (left.value === '@me') || right.count - left.count || left.label.localeCompare(right.label));
      }
      view.options.set(key, options);
      return options;
    }

    lookup(key, value) {
      const lowered = value.toLowerCase();
      return this.options(key).find((option) => option.value.toLowerCase() === lowered) || null;
    }

    // The qualifier still being typed matches as a prefix, so the list narrows instead of emptying.
    typingToken() {
      const tokens = /\s$/.test(this.draft) ? [] : search.tokenize(this.draft);
      return tokens.length > 0 && tokens[tokens.length - 1].key ? tokens[tokens.length - 1] : null;
    }

    // Value counts in menus and suggestions use the filters already added, not the text still being typed.
    committedFilters() {
      return search.planQuery(this.query).filters;
    }

    fullQuery() {
      return [this.query.trim(), this.draft.trim()].filter(Boolean).join(' ');
    }

    setDraft(draft) {
      if (draft === this.draft) return;
      this.draft = draft;
      this.render();
    }

    addDraft(text) {
      this.draft = '';
      this.setQuery(search.replaceTokens(this.query, [], [text]), { commit: true });
    }

    searchModel() {
      const { result, plan, context, matched } = this.view;
      const pullRequests = result.items;
      const query = this.query;
      const apply = (next) => this.setQuery(next, { commit: true });
      const counts = this.counts.get(this.request.githubTerms ? this.request.githubTerms.join(' ') : '') || null;
      const countWith = (next) => {
        const filters = search.planQuery([next, this.draft].join(' ')).filters;
        return pullRequests.filter((pullRequest) => search.matchesAll(pullRequest, filters, context)).length;
      };
      const chip = (id, label, icon, key, value, title, negated = false) => {
        const active = search.hasToken(query, key, value, negated);
        const next = search.toggleToken(query, key, value, negated);
        return { id, label, icon, title, active, count: active ? matched.size : countWith(next), onToggle: () => apply(next) };
      };
      const scope = this.cache.get(`${plan.scopeQuery}\n${plan.serverSort}`);
      return {
        query,
        draft: this.draft,
        states: plan.states,
        stateCounts: counts,
        truncated: scope && scope.truncated && !this.request.deep ? scope.total : null,
        summary: `${matched.size} ${this.noun()} match`,
        vocabulary: this.view.vocabulary || (this.view.vocabulary = this.vocabulary(pullRequests)),
        chips: this.quickFilters(chip).filter(Boolean),
        sort: {
          value: plan.sort,
          label: search.SORTS[plan.sort],
          options: this.sortChoices().map((value) => ({ value, label: search.SORTS[value] })),
          onChange: (value) => apply(search.setSort(query, value)),
        },
        clearable: search.clearFilters(query) !== query.trim() || this.draft.trim() !== '',
        options: (key) => this.options(key),
        lookup: (key, value) => this.lookup(key, value),
        labelFor: (key, value) => {
          const option = this.lookup(key, value);
          return option ? option.label : value;
        },
        onQuery: apply,
        onDraft: (draft) => this.setDraft(draft),
        onAddDraft: (text) => this.addDraft(text),
        onStates: (states) => apply(search.setStates(query, states)),
      };
    }

    // chip(id, label, icon, key, value, title, negated) makes one quick filter.
    quickFilters(chip) {
      return [
        chip('unread', 'Updated', 'dot-fill', 'is', 'unread', 'Updated since you last viewed them (is:unread)'),
        this.viewer ? chip('requested', 'Review requested', 'eye', 'review-requested', '@me', 'Waiting on your review (review-requested:@me)') : null,
        this.viewer ? chip('mine', 'Mine', 'person', 'author', '@me', 'Opened by you (author:@me)') : null,
        chip('stacked', 'In a stack', 'stack', 'is', 'stacked', 'Part of a stack (is:stacked)'),
        chip('drafts', 'Hide drafts', 'git-pull-request-draft', 'is', 'draft', 'Leave out drafts (-is:draft)', true),
      ];
    }

    sortChoices() {
      return Object.keys(search.SORTS);
    }

    allExpanded(entries) {
      return entries.filter((entry) => entry.type === 'stack').every((entry) => this.expanded.has(this.stackStorageKey(entry.stack)));
    }

    toggleAll(entries) {
      const expand = !this.allExpanded(entries);
      for (const entry of entries) {
        if (entry.type !== 'stack') continue;
        const key = this.stackStorageKey(entry.stack);
        if (expand) this.expanded.add(key);
        else this.expanded.delete(key);
      }
      api.writeLocal({ expandedStacks: [...this.expanded].slice(-200) });
      this.render();
    }

    renderStack(entry, rows, statuses, refining) {
      const { stack } = entry;
      const storageKey = this.stackStorageKey(stack);
      const expanded = refining || this.expanded.has(storageKey);
      const hiddenCount = entry.rows.length - rows.length;
      const revealed = hiddenCount > 0 && this.revealed.has(storageKey);
      const matching = new Set(rows.map((row) => row.pullRequest.number));
      const listed = new Map(entry.rows.map((row) => [row.pullRequest.number, row.pullRequest]));
      const awaiting = entry.rows.map((row) => statuses.get(row.pullRequest.number)).filter((status) => status.kind === 'awaiting');
      const oldest = awaiting.reduce((worst, status) => (!worst || status.hours > worst.hours ? status : worst), null);
      const merged = stack.members.filter((member) => member.state === 'merged').length;
      const queued = entry.rows.filter((row) => row.pullRequest.isInMergeQueue).length;
      // With nothing waiting for review, the member closest to merging speaks for the stack.
      const nextInQueue = entry.rows
        .map((row) => statuses.get(row.pullRequest.number))
        .filter((status) => status.kind === 'queued')
        .reduce((first, status) => (!first || (status.position || Infinity) < (first.position || Infinity) ? status : first), null);
      const authors = [...new Set(entry.rows.map((row) => (row.pullRequest.author ? row.pullRequest.author.login : 'ghost')))];
      const unreadRows = entry.rows.filter((row) => isUnread(row.pullRequest));
      const unread = unreadRows.length;
      const { owner, repository } = this.route;

      const segments = stack.members.map((member) => {
        const pullRequest = listed.get(member.number);
        const status = pullRequest ? statuses.get(member.number) : null;
        const tone = !status ? `kind-${member.state === 'open' ? 'unlisted' : member.state}` : status.kind === 'awaiting' ? `level-${status.level}` : `kind-${status.kind}`;
        const note = status && status.kind === 'bot_approved' ? ` (approved by ${status.botApprovals.join(', ')})` : '';
        const description = pullRequest ? `${member.position}. #${member.number} ${pullRequest.title}${note}` : `${member.position}. #${member.number} (${member.state === 'open' ? 'not in this list' : member.state})`;
        const dimmed = refining && pullRequest && !matching.has(member.number);
        return element('a', {
          className: `ghs-segment ghs-segment--${tone}${pullRequest && isUnread(pullRequest) ? ' is-unread' : ''}${dimmed ? ' is-dimmed' : ''}`,
          attributes: { href: `/${owner}/${repository}/pull/${member.number}`, title: description, 'aria-label': description },
        });
      });

      const chevron = element(
        'button',
        { className: 'ghs-chevron', attributes: { type: 'button', 'aria-expanded': String(expanded), 'aria-label': expanded ? 'Collapse stack' : 'Expand stack' } },
        octicon('chevron-right'),
      );
      const unreadTitle = `${unread} updated since you last viewed ${unread === 1 ? 'it' : 'them'}`;
      const unreadItems = () =>
        unreadRows.map((row) =>
          element('li', { className: 'ghs-popover-item' }, [
            element('span', { className: 'ghs-popover-icon' }, stateIcon(pullRequestState(row.pullRequest))),
            element('div', { className: 'ghs-popover-text' }, [
              element('a', { className: 'ghs-popover-link', attributes: { href: row.pullRequest.url } }, [element('span', { className: 'ghs-popover-time', text: `${row.position}. #${row.pullRequest.number} ` }), row.pullRequest.title]),
            ]),
          ]),
        );
      const unreadBar = unread > 0 ? unreadMarker('ghs-unread-bar', `${unreadTitle}. Show which`) : null;
      const unreadCount = unread > 0 ? element('span', { className: 'ghs-meta-unread', text: `${unread} updated`, attributes: { tabindex: '0', role: 'button', 'aria-haspopup': 'dialog' } }) : null;
      for (const anchor of [unreadBar, unreadCount].filter(Boolean)) root.GitHubStacks.activityPopover.bindList(anchor, unreadTitle, unreadItems());
      const header = element('div', { className: `ghs-stack-header${unread > 0 ? ' is-unread' : ''}` }, [
        unreadBar,
        chevron,
        element('div', { className: 'ghs-stack-icon' }, octicon('stack')),
        element('div', { className: 'ghs-stack-main' }, [
          element('div', { className: 'ghs-stack-title-line' }, [
            element('span', { className: 'ghs-stack-label', text: stack.inferred ? 'Stack · from branches' : `Stack #${stack.number}` }),
            element('span', { className: 'ghs-stack-title', text: entry.rows[0].pullRequest.title }),
          ]),
          element('div', { className: 'ghs-meta' }, [
            `${stack.members.length} PRs`,
            hiddenCount > 0 ? separator() : null,
            hiddenCount > 0 ? element('span', { className: 'ghs-meta-match', text: `${rows.length} of ${entry.rows.length} match` }) : null,
            separator(),
            `${awaiting.length} awaiting review`,
            unread > 0 ? separator() : null,
            unreadCount,
            queued > 0 ? separator() : null,
            queued > 0 ? element('span', { className: 'ghs-meta-queued' }, [octicon('git-merge-queue'), `${queued} queued`]) : null,
            merged > 0 ? separator() : null,
            merged > 0 ? `${merged} merged` : null,
            separator(),
            `by ${authors.join(', ')}`,
            separator(),
            'onto ',
            element('span', { className: 'ghs-branch', text: stack.base || 'main' }),
          ]),
          element('div', { className: 'ghs-progress', attributes: { role: 'group', 'aria-label': 'Stack members, bottom to top' } }, segments),
        ]),
        element('div', { className: 'ghs-stack-signals' }, oldest ? statusPill(oldest) : nextInQueue ? statusPill(nextInQueue) : element('span', { className: 'ghs-status ghs-status--muted', text: 'Nothing waiting' })),
      ]);
      header.addEventListener('click', (event) => {
        if (event.target.closest('a, [role="button"]')) return;
        if (!refining) this.toggleStack(stack, !expanded);
      });
      if (refining) chevron.disabled = true;

      const group = element('div', { className: `ghs-stack${expanded ? ' is-expanded' : ''}`, attributes: { role: 'listitem' } }, [header]);
      if (expanded) {
        const body = element('div', { className: 'ghs-stack-rows' });
        const shown = revealed ? entry.rows : rows;
        shown.forEach((row, index) => {
          const gutter = element('div', { className: `ghs-gutter${index === 0 ? ' is-first' : ''}${index === shown.length - 1 ? ' is-last' : ''}` }, [
            element('span', { className: 'ghs-gutter-line' }),
            element('span', { className: 'ghs-gutter-node', text: String(row.position) }),
          ]);
          const node = pullRequestRow(row.pullRequest, statuses.get(row.pullRequest.number), { gutter });
          if (!matching.has(row.pullRequest.number)) node.classList.add('is-dimmed');
          body.append(node);
        });
        if (hiddenCount > 0) {
          const toggle = element('button', { className: 'ghs-reveal', attributes: { type: 'button', 'aria-expanded': String(revealed) } }, [
            octicon(revealed ? 'chevron-up' : 'chevron-down'),
            revealed ? 'Show only the matches' : `Show the other ${hiddenCount} in this stack`,
          ]);
          toggle.addEventListener('click', () => {
            if (revealed) this.revealed.delete(storageKey);
            else this.revealed.add(storageKey);
            this.render();
          });
          body.append(toggle);
        }
        group.append(body);
      }
      return group;
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { ListView, findNativeList, listViewNothing: NOTHING });
})(globalThis);
