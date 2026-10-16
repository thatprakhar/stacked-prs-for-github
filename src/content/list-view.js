(function (root) {
  const { octicon, api, reviewStatus, groupPullRequests } = root.GitHubStacks;
  const { element, statusPill, pullRequestRow, separator, isUnread, LEVEL_TEXT, LEVEL_TONE } = root.GitHubStacks.render;

  const REFRESH_MILLISECONDS = 3 * 60 * 1000;
  const REFRESH_ON_RETURN_MILLISECONDS = 30 * 1000;
  const LEVELS = ['breached', 'at_risk', 'on_track'];
  const PAGINATION_SELECTOR = 'nav[aria-label="Pagination"], nav[aria-label="pagination"], .paginate-container, [data-testid="pagination"]';

  function pullRequestLinkPattern(route) {
    return new RegExp(`^/${route.owner}/${route.repository}/pull/\\d+/?$`, 'i');
  }

  function findNativeList(route, ownRoot) {
    const pattern = pullRequestLinkPattern(route);
    const links = [...document.querySelectorAll('a[href*="/pull/"]')].filter((link) => {
      if (ownRoot.contains(link) || link.closest('.ghs-navigator')) return false;
      try {
        return pattern.test(new URL(link.href, location.href).pathname);
      } catch {
        return false;
      }
    });
    if (links.length === 0) return null;
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

  function currentQuery(ownRoot) {
    const fromUrl = new URLSearchParams(location.search).get('q');
    if (fromUrl) return fromUrl;
    const input = [...document.querySelectorAll('input')].find(
      (candidate) => !ownRoot.contains(candidate) && /(^|\s)(is|state):(pr|open|closed|merged)(\s|$)/.test(candidate.value),
    );
    return input ? input.value : 'is:pr is:open';
  }

  class ListView {
    constructor() {
      this.root = element('section', { className: 'ghs-root', attributes: { 'aria-label': 'Stacked pull requests' } });
      this.native = null;
      this.key = null;
      this.data = null;
      this.error = null;
      this.loading = false;
      this.filter = null;
      this.enabled = true;
      this.expanded = new Set();
      this.ready = Promise.all([api.readLocal('stackedView', true), api.readLocal('expandedStacks', [])]).then(([enabled, expanded]) => {
        this.enabled = enabled;
        this.expanded = new Set(expanded);
      });
      setInterval(() => this.tick(), 60 * 1000);
      document.addEventListener('visibilitychange', () => this.tick(REFRESH_ON_RETURN_MILLISECONDS));
    }

    sync(route) {
      this.route = route;
      const native = findNativeList(route, this.root);
      if (!native) {
        if (!this.root.isConnected) return;
        if (this.data && this.data.pullRequests.length > 0 && currentQuery(this.root) === this.query) return;
        this.unmount();
        return;
      }
      if (this.native && this.native !== native) this.native.classList.remove('ghs-native-hidden');
      this.native = native;
      if (!this.root.isConnected || this.root.parentElement !== native.parentElement) native.before(this.root);

      const query = currentQuery(this.root);
      const key = `${route.host}/${route.owner}/${route.repository}?${query}`;
      if (key !== this.key) {
        this.key = key;
        this.query = query;
        this.data = null;
        this.error = null;
        this.load();
      }
      this.applyNativeVisibility();
    }

    unmount() {
      this.root.remove();
      if (this.native) this.native.classList.remove('ghs-native-hidden');
      for (const pagination of document.querySelectorAll(PAGINATION_SELECTOR)) pagination.classList.remove('ghs-native-hidden');
      this.native = null;
      this.key = null;
    }

    applyNativeVisibility() {
      const hide = this.enabled && Boolean(this.data) && !this.error;
      if (this.native && this.native.classList.contains('ghs-native-hidden') !== hide) this.native.classList.toggle('ghs-native-hidden', hide);
      for (const pagination of document.querySelectorAll(PAGINATION_SELECTOR)) {
        if (pagination.classList.contains('ghs-native-hidden') !== hide) pagination.classList.toggle('ghs-native-hidden', hide);
      }
    }

    tick(maximumAge = REFRESH_MILLISECONDS) {
      if (!this.root.isConnected || document.visibilityState !== 'visible' || !this.data) return;
      if (!api.extensionAlive()) {
        if (!this.stale) {
          this.stale = true;
          this.render();
        }
        return;
      }
      if (Date.now() - this.data.fetchedAt > maximumAge) this.load({ quiet: true });
      else this.render();
    }

    async load({ quiet = false } = {}) {
      const key = this.key;
      const { owner, repository } = this.route;
      this.loading = true;
      if (!quiet) this.render();
      try {
        await this.ready;
        const [settings, result, stacks] = await Promise.all([
          api.settings(),
          api.searchPullRequests(owner, repository, this.query),
          api.listStacks(owner, repository),
        ]);
        if (key !== this.key) return;
        this.data = { ...result, stacks, settings, fetchedAt: Date.now() };
        this.error = null;
      } catch (error) {
        if (key !== this.key) return;
        if (error.code === api.CONTEXT_INVALIDATED && this.data) this.stale = true;
        else this.error = error;
      } finally {
        if (key === this.key) {
          this.loading = false;
          this.render();
          this.applyNativeVisibility();
        }
      }
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      api.writeLocal({ stackedView: enabled });
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
      const content = this.enabled ? this.renderContent() : [this.renderCollapsedBar()];
      this.root.replaceChildren(...content);
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

    renderContent() {
      if (this.error && this.error.code === api.CONTEXT_INVALIDATED) {
        return [this.renderMessage([octicon('sync'), ' Stacked PRs for GitHub was updated. Refresh the page to use it.'], [this.button('Refresh page', () => location.reload(), 'sync', 'ghs-button--primary')])];
      }
      if (this.error) {
        const needsToken = this.error.code === 'no_token' || this.error.code === 'bad_token';
        return [
          this.renderMessage(
            needsToken
              ? [octicon('stack'), ` ${this.error.code === 'no_token' ? 'Add' : 'Replace'} the GitHub token for ${this.route.host} to see stacked pull requests.`]
              : [octicon('x'), ` Could not load stacked pull requests: ${this.error.message}`],
            needsToken
              ? [this.button(this.error.code === 'no_token' ? 'Add a token' : 'Replace the token', () => api.openOptions(), 'gear', 'ghs-button--primary'), this.iconButton('Turn off stacked view', 'x', () => this.setEnabled(false))]
              : [this.button('Retry', () => this.load(), 'sync'), this.iconButton('Turn off stacked view', 'x', () => this.setEnabled(false))],
          ),
        ];
      }
      if (!this.data) {
        return [this.renderMessage([element('span', { className: 'ghs-spinner', attributes: { 'aria-hidden': 'true' } }), ' Loading stacked pull requests…'], [])];
      }

      const { settings } = this.data;
      const now = Date.now();
      const statuses = new Map(this.data.pullRequests.map((pullRequest) => [pullRequest.number, reviewStatus(pullRequest, now, settings)]));
      const entries = groupPullRequests(this.data.pullRequests, this.data.stacks);
      const counts = { breached: 0, at_risk: 0, on_track: 0 };
      for (const status of statuses.values()) if (status.kind === 'awaiting') counts[status.level] += 1;
      const matches = (pullRequest) => !this.filter || (statuses.get(pullRequest.number).kind === 'awaiting' && statuses.get(pullRequest.number).level === this.filter);

      const list = element('div', { className: 'ghs-list', attributes: { role: 'list' } });
      for (const entry of entries) {
        if (entry.type === 'single') {
          if (!matches(entry.pullRequest)) continue;
          list.append(
            element('div', { className: 'ghs-entry', attributes: { role: 'listitem' } }, pullRequestRow(entry.pullRequest, statuses.get(entry.pullRequest.number), { stack: entry.stack, position: entry.position, standalone: true })),
          );
          continue;
        }
        const rows = entry.rows.filter((row) => matches(row.pullRequest));
        if (rows.length === 0) continue;
        list.append(this.renderStack(entry, rows, statuses));
      }
      if (!list.firstChild) list.append(element('div', { className: 'ghs-empty', text: this.filter ? `No pull requests are ${LEVEL_TEXT[this.filter].toLowerCase()}.` : 'No pull requests match.' }));

      const stackCount = entries.filter((entry) => entry.type === 'stack').length;
      const toolbar = element('div', { className: 'ghs-toolbar' }, [
        element('div', { className: 'ghs-toolbar-title' }, [
          octicon('stack'),
          'Stacked view',
          element('span', { className: 'ghs-counter', text: String(this.data.pullRequests.length) }),
          stackCount > 0 ? element('span', { className: 'ghs-toolbar-note', text: `${stackCount} ${stackCount === 1 ? 'stack' : 'stacks'}` }) : null,
        ]),
        element(
          'div',
          { className: 'ghs-summary', attributes: { role: 'group', 'aria-label': 'Filter by review SLA' } },
          LEVELS.map((level) => {
            const pressed = this.filter === level;
            const chip = element(
              'button',
              { className: `ghs-pill ghs-pill--${LEVEL_TONE[level]} ghs-pill--button${pressed ? ' is-pressed' : ''}`, attributes: { type: 'button', 'aria-pressed': String(pressed), title: `Show only pull requests that are ${LEVEL_TEXT[level].toLowerCase()}` } },
              [`${LEVEL_TEXT[level]}: `, element('span', { className: 'ghs-pill-hours', text: String(counts[level]) })],
            );
            chip.addEventListener('click', () => {
              this.filter = pressed ? null : level;
              this.render();
            });
            return chip;
          }),
        ),
        element('div', { className: 'ghs-actions' }, [
          stackCount > 0 ? this.button(this.allExpanded(entries) ? 'Collapse all' : 'Expand all', () => this.toggleAll(entries), null, 'ghs-button--small') : null,
          this.iconButton('Refresh', 'sync', () => (this.stale ? location.reload() : this.load({ quiet: true })), this.loading ? 'is-spinning' : ''),
          this.iconButton('Settings', 'gear', () => api.openOptions()),
          this.iconButton('Show the GitHub list', 'list-unordered', () => this.setEnabled(false)),
        ]),
      ]);

      const updated = new Date(this.data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const workdays = settings.workdays.length === 5 && settings.workdays.every((day, index) => day === index + 1) ? 'Mon–Fri' : `${settings.workdays.length} days a week`;
      const footer = element('div', { className: 'ghs-footer' }, [
        this.data.total > this.data.pullRequests.length ? `Showing the first ${this.data.pullRequests.length} of ${this.data.total}` : `${this.data.total} pull requests`,
        separator(),
        `SLA ${settings.slaHours} work hours, at risk after ${settings.atRiskHours}`,
        separator(),
        `${workdays} ${settings.workdayStart}:00–${settings.workdayEnd}:00 ${settings.timeZone}`,
        separator(),
        `Updated ${updated}`,
      ]);
      return [this.stale ? this.renderStaleNotice() : null, toolbar, list, footer].filter(Boolean);
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

    renderStack(entry, rows, statuses) {
      const { stack } = entry;
      const expanded = Boolean(this.filter) || this.expanded.has(this.stackStorageKey(stack));
      const listed = new Map(entry.rows.map((row) => [row.pullRequest.number, row.pullRequest]));
      const awaiting = entry.rows.map((row) => statuses.get(row.pullRequest.number)).filter((status) => status.kind === 'awaiting');
      const oldest = awaiting.reduce((worst, status) => (!worst || status.hours > worst.hours ? status : worst), null);
      const merged = stack.members.filter((member) => member.state === 'merged').length;
      const authors = [...new Set(entry.rows.map((row) => (row.pullRequest.author ? row.pullRequest.author.login : 'ghost')))];
      const unread = entry.rows.filter((row) => isUnread(row.pullRequest)).length;
      const { owner, repository } = this.route;

      const segments = stack.members.map((member) => {
        const pullRequest = listed.get(member.number);
        const status = pullRequest ? statuses.get(member.number) : null;
        const tone = !status ? `kind-${member.state === 'open' ? 'unlisted' : member.state}` : status.kind === 'awaiting' ? `level-${status.level}` : `kind-${status.kind}`;
        const note = status && status.kind === 'bot_approved' ? ` (approved by ${status.botApprovals.join(', ')})` : '';
        const description = pullRequest ? `${member.position}. #${member.number} ${pullRequest.title}${note}` : `${member.position}. #${member.number} (${member.state === 'open' ? 'not in this list' : member.state})`;
        return element('a', {
          className: `ghs-segment ghs-segment--${tone}${pullRequest && isUnread(pullRequest) ? ' is-unread' : ''}`,
          attributes: { href: `/${owner}/${repository}/pull/${member.number}`, title: description, 'aria-label': description },
        });
      });

      const chevron = element(
        'button',
        { className: 'ghs-chevron', attributes: { type: 'button', 'aria-expanded': String(expanded), 'aria-label': expanded ? 'Collapse stack' : 'Expand stack' } },
        octicon('chevron-right'),
      );
      const header = element('div', { className: `ghs-stack-header${unread > 0 ? ' is-unread' : ''}` }, [
        chevron,
        element('div', { className: 'ghs-stack-icon' }, octicon('stack')),
        element('div', { className: 'ghs-stack-main' }, [
          element('div', { className: 'ghs-stack-title-line' }, [
            element('span', { className: 'ghs-stack-label', text: stack.inferred ? 'Stack · from branches' : `Stack #${stack.number}` }),
            element('span', { className: 'ghs-stack-title', text: entry.rows[0].pullRequest.title }),
          ]),
          element('div', { className: 'ghs-meta' }, [
            `${stack.members.length} PRs`,
            separator(),
            `${awaiting.length} awaiting review`,
            unread > 0 ? separator() : null,
            unread > 0 ? element('span', { className: 'ghs-meta-unread', text: `${unread} updated`, attributes: { title: `${unread} updated since you last viewed them` } }) : null,
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
        element('div', { className: 'ghs-stack-signals' }, oldest ? statusPill(oldest) : element('span', { className: 'ghs-status ghs-status--muted', text: 'Nothing waiting' })),
      ]);
      header.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        this.toggleStack(stack, !expanded);
      });

      const group = element('div', { className: `ghs-stack${expanded ? ' is-expanded' : ''}`, attributes: { role: 'listitem' } }, [header]);
      if (expanded) {
        const body = element('div', { className: 'ghs-stack-rows' });
        rows.forEach((row, index) => {
          const gutter = element('div', { className: `ghs-gutter${index === 0 ? ' is-first' : ''}${index === rows.length - 1 ? ' is-last' : ''}` }, [
            element('span', { className: 'ghs-gutter-line' }),
            element('span', { className: 'ghs-gutter-node', text: String(row.position) }),
          ]);
          body.append(pullRequestRow(row.pullRequest, statuses.get(row.pullRequest.number), { gutter }));
        });
        group.append(body);
      }
      return group;
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { ListView, findNativeList });
})(globalThis);
