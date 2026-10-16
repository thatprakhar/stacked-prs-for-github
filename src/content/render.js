(function (root) {
  const { octicon } = root.GitHubStacks;

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    for (const [name, value] of Object.entries(options.attributes || {})) {
      if (value !== null && value !== undefined) node.setAttribute(name, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const LEVEL_TEXT = { breached: 'SLA breached', at_risk: 'At risk', on_track: 'On track' };
  const LEVEL_TONE = { breached: 'danger', at_risk: 'attention', on_track: 'success' };

  const STATUS_LABEL = {
    approved: { text: 'Approved', tone: 'success', icon: 'check' },
    bot_approved: { text: 'Bot approved', tone: 'success', icon: 'check' },
    changes_requested: { text: 'Changes requested', tone: 'danger', icon: 'x' },
    reviewed: { text: 'Reviewed', tone: 'muted', icon: 'comment' },
    draft: { text: 'Draft', tone: 'muted', icon: null },
    merged: { text: 'Merged', tone: 'done', icon: null },
    closed: { text: 'Closed', tone: 'muted', icon: null },
  };

  function formatHours(hours) {
    return hours >= 100 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
  }

  function statusPill(status) {
    if (status.kind === 'awaiting') {
      return element(
        'span',
        {
          className: `ghs-pill ghs-pill--${LEVEL_TONE[status.level]}`,
          attributes: { title: `${formatHours(status.hours)} of work time since it was ready for review, with no human review yet` },
        },
        [element('span', { className: 'ghs-pill-hours', text: formatHours(status.hours) }), ` · ${LEVEL_TEXT[status.level]}`],
      );
    }
    const label = STATUS_LABEL[status.kind];
    const title = status.kind === 'bot_approved' ? `Approved by ${status.botApprovals.join(', ')}; no person has reviewed it yet` : null;
    return element('span', { className: `ghs-status ghs-status--${label.tone}`, attributes: { title } }, [label.icon ? octicon(label.icon) : null, label.text]);
  }

  function stateIcon(pullRequestState) {
    switch (pullRequestState) {
      case 'merged':
        return octicon('git-merge', 'ghs-state ghs-state--merged');
      case 'closed':
        return octicon('git-pull-request-closed', 'ghs-state ghs-state--closed');
      case 'draft':
        return octicon('git-pull-request-draft', 'ghs-state ghs-state--draft');
      default:
        return octicon('git-pull-request', 'ghs-state ghs-state--open');
    }
  }

  function pullRequestState(pullRequest) {
    if (pullRequest.state === 'MERGED') return 'merged';
    if (pullRequest.state === 'CLOSED') return 'closed';
    if (pullRequest.isDraft) return 'draft';
    return 'open';
  }

  function avatar(actor, size = 20) {
    const login = actor ? actor.login : 'ghost';
    const fallback = () =>
      element('span', {
        className: 'ghs-avatar ghs-avatar--fallback',
        text: login.slice(0, 1).toUpperCase(),
        attributes: { style: `width:${size}px;height:${size}px`, title: login },
      });
    if (!actor || !actor.avatarUrl) return fallback();
    const image = element('img', {
      className: 'ghs-avatar',
      attributes: { src: actor.avatarUrl, alt: `@${login}`, title: login, width: size, height: size, loading: 'lazy' },
    });
    image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
    return image;
  }

  function checksIcon(pullRequest) {
    const node = pullRequest.commits && pullRequest.commits.nodes[0];
    const rollup = node && node.commit.statusCheckRollup;
    if (!rollup) return null;
    if (rollup.state === 'SUCCESS') return element('span', { className: 'ghs-checks ghs-checks--success', attributes: { title: 'All checks passed' } }, octicon('check'));
    if (rollup.state === 'FAILURE' || rollup.state === 'ERROR') {
      return element('span', { className: 'ghs-checks ghs-checks--danger', attributes: { title: 'Some checks failed' } }, octicon('x'));
    }
    return element('span', { className: 'ghs-checks ghs-checks--attention', attributes: { title: 'Checks are running' } }, octicon('dot-fill'));
  }

  function labelChip(label) {
    const red = parseInt(label.color.slice(0, 2), 16);
    const green = parseInt(label.color.slice(2, 4), 16);
    const blue = parseInt(label.color.slice(4, 6), 16);
    return element('span', {
      className: 'ghs-label',
      text: label.name,
      attributes: { style: `--ghs-label-r:${red};--ghs-label-g:${green};--ghs-label-b:${blue}` },
    });
  }

  function isUnread(pullRequest) {
    return pullRequest.isReadByViewer === false;
  }

  const UNREAD_TEXT = 'Updated since you last viewed it';

  function separator() {
    return element('span', { className: 'ghs-separator', text: '·', attributes: { 'aria-hidden': 'true' } });
  }

  function pullRequestRow(pullRequest, status, options = {}) {
    const labels = (pullRequest.labels && pullRequest.labels.nodes) || [];
    const comments = pullRequest.comments ? pullRequest.comments.totalCount : 0;
    const login = pullRequest.author ? pullRequest.author.login : 'ghost';
    const stackBadge =
      options.stack && options.standalone
        ? element('span', { className: 'ghs-stack-badge', attributes: { title: 'Position in its stack' } }, [
            octicon('stack'),
            `${options.position}/${options.stack.members.length}`,
          ])
        : null;

    const unread = isUnread(pullRequest);
    return element('div', { className: `ghs-row${options.current ? ' is-current' : ''}${unread ? ' is-unread' : ''}`, attributes: { 'data-number': pullRequest.number } }, [
      options.gutter || null,
      element('div', { className: 'ghs-row-icon' }, stateIcon(pullRequestState(pullRequest))),
      element('div', { className: 'ghs-row-avatar' }, avatar(pullRequest.author)),
      element('div', { className: 'ghs-row-main' }, [
        unread ? element('span', { className: 'ghs-visually-hidden', text: `${UNREAD_TEXT}.` }) : null,
        element('div', { className: 'ghs-row-title-line' }, [
          element('a', { className: 'ghs-row-title', text: pullRequest.title, attributes: { href: pullRequest.url, 'data-turbo-frame': '_top' } }),
          ...labels.map(labelChip),
        ]),
        element('div', { className: 'ghs-meta' }, [
          `#${pullRequest.number}`,
          separator(),
          element('span', { className: 'ghs-meta-author', text: login }),
          separator(),
          element('span', { className: 'ghs-branch', text: pullRequest.headRefName }),
          ' → ',
          element('span', { className: 'ghs-branch', text: pullRequest.baseRefName }),
          stackBadge ? separator() : null,
          stackBadge,
        ]),
      ]),
      element('div', { className: 'ghs-row-signals' }, [
        element('span', { className: 'ghs-signal ghs-signal--checks' }, checksIcon(pullRequest)),
        element(
          'span',
          { className: 'ghs-signal ghs-signal--comments' },
          comments > 0 ? element('a', { className: 'ghs-comments', attributes: { href: pullRequest.url, title: `${comments} comments` } }, [octicon('comment'), String(comments)]) : null,
        ),
        element('span', { className: 'ghs-signal ghs-signal--status' }, statusPill(status)),
      ]),
    ]);
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, {
    render: { element, statusPill, stateIcon, pullRequestState, avatar, pullRequestRow, formatHours, separator, isUnread, UNREAD_TEXT, LEVEL_TEXT, LEVEL_TONE },
  });
})(globalThis);
