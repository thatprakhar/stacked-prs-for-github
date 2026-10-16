(function (root) {
  const { octicon, api, describeActivity, relativeTime } = root.GitHubStacks;
  const { element, avatar } = root.GitHubStacks.render;

  const SHOW_DELAY_MILLISECONDS = 150;
  const HIDE_DELAY_MILLISECONDS = 200;
  const CACHE_MILLISECONDS = 60 * 1000;
  const FALLBACK_EVENTS = 6;
  const GAP = 8;

  const EVENT_ICON = {
    commit: 'git-pull-request',
    push: 'sync',
    comment: 'comment',
    review: 'comment',
    approved: 'check',
    changes_requested: 'x',
    merged: 'git-merge',
    closed: 'git-pull-request-closed',
    branch: 'git-branch',
  };

  function pullRequestAddress(url) {
    const [, owner, repository, , number] = new URL(url).pathname.split('/');
    return { owner, repository, number: Number(number) };
  }

  class ActivityPopover {
    constructor() {
      this.node = element('div', { className: 'ghs-popover', attributes: { role: 'dialog', 'aria-label': 'What changed' } });
      this.cache = new Map();
      this.node.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
      this.node.addEventListener('mouseleave', () => this.scheduleHide());
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.hide();
      });
      window.addEventListener('scroll', () => this.position(), { passive: true, capture: true });
      window.addEventListener('resize', () => this.position(), { passive: true });
    }

    bind(anchor, load) {
      anchor.addEventListener('mouseenter', () => this.scheduleShow(anchor, load));
      anchor.addEventListener('mouseleave', () => this.scheduleHide());
      anchor.addEventListener('focus', () => this.show(anchor, load));
      anchor.addEventListener('blur', () => this.scheduleHide());
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.show(anchor, load);
      });
    }

    bindPullRequest(anchor, pullRequest) {
      this.bind(anchor, () => this.pullRequestContent(pullRequest));
    }

    bindList(anchor, title, items) {
      this.bind(anchor, async () => [element('div', { className: 'ghs-popover-header', text: title }), element('ul', { className: 'ghs-popover-list' }, items)]);
    }

    scheduleShow(anchor, load) {
      clearTimeout(this.hideTimer);
      clearTimeout(this.showTimer);
      this.showTimer = setTimeout(() => this.show(anchor, load), SHOW_DELAY_MILLISECONDS);
    }

    scheduleHide() {
      clearTimeout(this.showTimer);
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MILLISECONDS);
    }

    hide() {
      clearTimeout(this.showTimer);
      this.anchor = null;
      this.node.remove();
    }

    async show(anchor, load) {
      clearTimeout(this.hideTimer);
      if (this.anchor === anchor && this.node.isConnected) return;
      this.anchor = anchor;
      this.node.replaceChildren(element('div', { className: 'ghs-popover-loading' }, [element('span', { className: 'ghs-spinner', attributes: { 'aria-hidden': 'true' } }), ' Loading what changed…']));
      document.body.append(this.node);
      this.position();
      let content;
      try {
        content = await load();
      } catch (error) {
        content = [element('div', { className: 'ghs-popover-empty', text: `Could not load the activity: ${error.message}` })];
      }
      if (this.anchor !== anchor) return;
      this.node.replaceChildren(...content);
      this.position();
    }

    position() {
      if (!this.anchor) return;
      const anchor = this.anchor.getBoundingClientRect();
      const width = this.node.offsetWidth;
      const height = this.node.offsetHeight;
      let left = anchor.right + GAP;
      if (left + width > window.innerWidth - GAP) left = Math.max(GAP, anchor.left - width - GAP);
      const top = Math.min(Math.max(GAP, anchor.top - 4), Math.max(GAP, window.innerHeight - height - GAP));
      this.node.style.left = `${left}px`;
      this.node.style.top = `${top}px`;
    }

    async pullRequestContent(pullRequest) {
      const { owner, repository, number } = pullRequestAddress(pullRequest.url);
      const key = `${owner}/${repository}#${number}`;
      const cached = this.cache.get(key);
      if (!cached || Date.now() - cached.fetchedAt > CACHE_MILLISECONDS) {
        this.cache.set(key, { fetchedAt: Date.now(), result: api.activity(owner, repository, number) });
      }
      let result;
      try {
        result = await this.cache.get(key).result;
      } catch (error) {
        this.cache.delete(key);
        throw error;
      }
      const now = Date.now();
      const events = describeActivity(result.nodes, result.viewer);
      const shown = result.since ? events : events.slice(0, FALLBACK_EVENTS);
      const title = result.since ? `Since you last viewed it · ${relativeTime(Date.parse(result.since), now)}` : 'Latest activity';
      const items = shown.map((entry) =>
        element('li', { className: 'ghs-popover-item' }, [
          entry.avatar ? avatar({ login: entry.actor, avatarUrl: entry.avatar }, 20) : element('span', { className: 'ghs-popover-icon' }, octicon(EVENT_ICON[entry.kind] || 'dot-fill')),
          element('div', { className: 'ghs-popover-text' }, [
            element('div', {}, [
              element('strong', { text: entry.actor }),
              ` ${entry.text}`,
              element('span', { className: 'ghs-popover-time', text: ` · ${relativeTime(Date.parse(entry.at), now)}` }),
            ]),
            entry.detail ? element('div', { className: 'ghs-popover-detail', text: entry.detail }) : null,
          ]),
        ]),
      );
      return [
        element('div', { className: 'ghs-popover-header', text: title }),
        items.length > 0
          ? element('ul', { className: 'ghs-popover-list' }, items)
          : element('div', { className: 'ghs-popover-empty', text: 'No new commits, reviews or comments. GitHub also marks a pull request updated for changes this list does not show, such as edits.' }),
        element('a', { className: 'ghs-popover-footer', text: 'Open the pull request', attributes: { href: pullRequest.url } }),
      ];
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { activityPopover: new ActivityPopover() });
})(globalThis);
