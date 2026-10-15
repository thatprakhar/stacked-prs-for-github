(function (root) {
  const { octicon, api, reviewStatus } = root.GitHubStacks;
  const { element, statusPill, stateIcon, pullRequestState, avatar } = root.GitHubStacks.render;

  const MEMBER_STATE_ICON = { merged: 'merged', closed: 'closed', draft: 'draft', open: 'open' };

  class StackNavigator {
    constructor() {
      this.root = element('aside', { className: 'ghs-navigator', attributes: { 'aria-label': 'Pull request stack' } });
      this.key = null;
      this.collapsed = false;
      api.readLocal('navigatorCollapsed', false).then((collapsed) => {
        this.collapsed = Boolean(collapsed);
        if (this.view) this.render();
      });
    }

    sync(route) {
      const key = `${route.host}/${route.owner}/${route.repository}#${route.number}`;
      this.route = route;
      if (key !== this.key) {
        this.key = key;
        this.view = null;
        this.root.remove();
        this.load(key);
      } else if (this.view && !this.root.isConnected) {
        document.body.append(this.root);
      }
    }

    unmount() {
      this.root.remove();
      this.key = null;
      this.view = null;
    }

    async load(key) {
      const { owner, repository, number } = this.route;
      try {
        const settings = await api.settings();
        if (!settings.showNavigator) return;
        const stack = await api.stackForPullRequest(owner, repository, number);
        if (!stack || key !== this.key) return;
        const details = await api.pullRequestsByNumber(owner, repository, stack.pull_requests.map((member) => member.number));
        if (key !== this.key) return;
        this.view = { stack, details, settings };
        this.render();
        document.body.append(this.root);
      } catch (error) {
        console.warn('[Stacked PRs] Could not load the stack', error);
        if (key === this.key) this.unmount();
      }
    }

    setCollapsed(collapsed) {
      this.collapsed = collapsed;
      api.writeLocal({ navigatorCollapsed: collapsed });
      this.render();
    }

    hrefFor(number) {
      const { owner, repository } = this.route;
      return `/${owner}/${repository}/pull/${number}${this.route.tab ? `/${this.route.tab}` : ''}`;
    }

    navigationButton(label, icon, number) {
      if (!number) return element('button', { className: 'ghs-icon-button', attributes: { type: 'button', disabled: '', 'aria-label': label, title: label } }, octicon(icon));
      return element('a', { className: 'ghs-icon-button', attributes: { href: this.hrefFor(number), 'aria-label': label, title: `${label}: #${number}` } }, octicon(icon));
    }

    render() {
      const { stack, details, settings } = this.view;
      const members = stack.pull_requests;
      const index = members.findIndex((member) => member.number === this.route.number);
      const below = index > 0 ? members[index - 1].number : null;
      const above = index >= 0 && index < members.length - 1 ? members[index + 1].number : null;

      const toggle = element(
        'button',
        { className: 'ghs-icon-button', attributes: { type: 'button', 'aria-label': this.collapsed ? 'Show the stack' : 'Hide the stack', title: this.collapsed ? 'Show the stack' : 'Hide the stack', 'aria-expanded': String(!this.collapsed) } },
        octicon(this.collapsed ? 'list-unordered' : 'dash'),
      );
      toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));

      const header = element('div', { className: 'ghs-navigator-header' }, [
        element('div', { className: 'ghs-navigator-title' }, [
          octicon('stack'),
          element('span', { text: `Stack #${stack.number}` }),
          element('span', { className: 'ghs-counter', text: `${index + 1} / ${members.length}` }),
        ]),
        element('div', { className: 'ghs-actions' }, [
          this.navigationButton('Previous in the stack, closer to the base', 'chevron-up', below),
          this.navigationButton('Next in the stack', 'chevron-down', above),
          element('span', { className: 'ghs-divider', attributes: { 'aria-hidden': 'true' } }),
          toggle,
        ]),
      ]);

      if (this.collapsed) {
        this.root.className = 'ghs-navigator is-collapsed';
        this.root.replaceChildren(header);
        return;
      }

      const now = Date.now();
      const list = element('ol', { className: 'ghs-navigator-list' }, [
        element('li', { className: 'ghs-navigator-item ghs-navigator-item--trunk' }, [
          element('span', { className: 'ghs-gutter is-first' }, [element('span', { className: 'ghs-gutter-line' }), element('span', { className: 'ghs-gutter-node ghs-gutter-node--trunk' }, octicon('git-branch'))]),
          element('span', { className: 'ghs-branch', text: stack.base ? stack.base.ref : 'main' }),
        ]),
        ...members.map((member, position) => {
          const pullRequest = details.get(member.number);
          const current = member.number === this.route.number;
          const state = pullRequest ? pullRequestState(pullRequest) : MEMBER_STATE_ICON[member.merged_at ? 'merged' : member.state === 'closed' ? 'closed' : member.draft ? 'draft' : 'open'];
          return element('li', { className: `ghs-navigator-item${current ? ' is-current' : ''}`, attributes: current ? { 'aria-current': 'page' } : {} }, [
            element('span', { className: `ghs-gutter${position === members.length - 1 ? ' is-last' : ''}` }, [
              element('span', { className: 'ghs-gutter-line' }),
              element('span', { className: 'ghs-gutter-node', text: String(position + 1) }),
            ]),
            stateIcon(state),
            pullRequest ? avatar(pullRequest.author, 16) : null,
            element('a', { className: 'ghs-navigator-link', attributes: { href: this.hrefFor(member.number), title: pullRequest ? pullRequest.title : `#${member.number}` } }, [
              element('span', { className: 'ghs-navigator-number', text: `#${member.number}` }),
              element('span', { className: 'ghs-navigator-text', text: pullRequest ? pullRequest.title : '' }),
            ]),
            pullRequest ? statusPill(reviewStatus(pullRequest, now, settings)) : null,
          ]);
        }),
      ]);

      this.root.className = 'ghs-navigator';
      this.root.replaceChildren(header, list);
      const currentItem = list.querySelector('.is-current');
      if (currentItem) requestAnimationFrame(() => {
        list.scrollTop = currentItem.offsetTop - list.clientHeight / 2;
      });
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { StackNavigator });
})(globalThis);
