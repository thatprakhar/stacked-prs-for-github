(function (root) {
  const { octicon, search } = root.GitHubStacks;
  const { element, avatar } = root.GitHubStacks.render;

  const GAP = 4;
  const MAXIMUM_VALUE_MATCHES = 6;
  const MAXIMUM_MATCHES_PER_FIELD = 2;
  const STATE_TABS = [
    { id: 'open', label: 'Open', states: ['open'], title: 'Open pull requests' },
    { id: 'merged', label: 'Merged', states: ['merged'], title: 'Merged pull requests' },
    { id: 'closed', label: 'Closed', states: ['closed'], title: 'Closed without merging' },
    { id: 'all', label: 'All', states: ['open', 'merged', 'closed'], title: 'Every pull request' },
  ];

  // What a filter token can be. type: 'text' edits words, 'enum' picks from fixed values, 'entity' picks from the
  // loaded pull requests' people, labels or branches and also takes any typed value.
  const FIELDS = [
    { key: null, label: 'Text', icon: 'search', type: 'text', description: 'Words in titles, numbers, branches, authors or labels' },
    { key: 'author', label: 'Author', icon: 'person', type: 'entity', description: 'Opened by' },
    { key: 'label', label: 'Label', icon: 'tag', type: 'entity', description: 'Has the label' },
    { key: 'review', label: 'Review', icon: 'eye', type: 'enum', description: 'Approved, changes requested, not reviewed…' },
    { key: 'sla', label: 'Review SLA', icon: 'dot-fill', type: 'enum', description: 'Breached, at risk or on track' },
    { key: 'status', label: 'Checks', icon: 'check', type: 'enum', description: 'Passing, failing or running' },
    { key: 'review-requested', label: 'Review requested from', icon: 'eye', type: 'entity', description: 'Waiting on a reviewer' },
    { key: 'reviewed-by', label: 'Reviewed by', icon: 'person', type: 'entity', description: 'Someone reviewed it' },
    { key: 'assignee', label: 'Assignee', icon: 'person', type: 'entity', description: 'Assigned to' },
    { key: 'is', label: 'Is', icon: 'filter', type: 'enum', description: 'Draft, updated since you viewed it, in a stack' },
    { key: 'no', label: 'Missing', icon: 'dash', type: 'enum', description: 'No label, assignee or review request' },
    { key: 'head', label: 'From branch', icon: 'git-branch', type: 'entity', description: 'Head branch' },
    { key: 'base', label: 'Into branch', icon: 'git-branch', type: 'entity', description: 'Base branch' },
    { key: 'involves', label: 'Involves', icon: 'person', type: 'entity', description: 'Author, assignee, mentioned or commenter, searched on GitHub' },
    { key: 'milestone', label: 'Milestone', icon: 'filter', type: 'text', description: 'Searched on GitHub' },
  ];
  const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));

  function fieldFor(key) {
    return FIELD_BY_KEY.get(key) || { key, label: key, icon: 'filter', type: 'text', description: 'Searched on GitHub' };
  }

  // The words on a token: "Author is any of", "Text contains", "Is not", "Missing".
  function describe(field, negated, count) {
    if (field.key === 'is') return { label: negated ? 'Is not' : 'Is', operator: '' };
    if (field.key === 'no') return { label: negated ? 'Has' : 'Missing', operator: '' };
    if (field.key === null) return { label: 'Text', operator: negated ? 'doesn’t contain' : 'contains' };
    if (count > 1) return { label: field.label, operator: negated ? 'is none of' : 'is any of' };
    return { label: field.label, operator: negated ? 'is not' : 'is' };
  }

  function operatorChoices(field) {
    if (field.key === null) return ['contains', 'doesn’t contain'];
    if (field.key === 'no') return ['Missing', 'Has'];
    return ['is', 'is not'];
  }

  // The tokens a query shows: one per qualifier, all words together (negated words in a second one). State and
  // sort are shown by the tabs and the sort menu instead.
  function tokensOf(query) {
    const tokens = [];
    const words = new Map();
    for (const token of search.tokenize(query)) {
      const kind = search.classify(token);
      if (kind === 'state' || kind === 'sort' || kind === 'ignore') continue;
      if (kind === 'text') {
        const existing = words.get(token.negated);
        if (existing) {
          existing.parts.push(token);
          existing.values.push(token.value);
          continue;
        }
        const entry = { field: FIELD_BY_KEY.get(null), negated: token.negated, parts: [token], values: [token.value] };
        words.set(token.negated, entry);
        tokens.push(entry);
        continue;
      }
      tokens.push({ field: fieldFor(token.key), negated: token.negated, parts: [token], values: token.values.map((value) => search.normalizeValue(token.key, value)) });
    }
    return tokens;
  }

  function isEditable(target) {
    return target instanceof Element && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function place(node, anchor, { width } = {}) {
    const rect = anchor.getBoundingClientRect();
    if (width) node.style.width = `${rect.width}px`;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - node.offsetWidth - 8));
    node.style.left = `${left}px`;
    node.style.top = `${rect.bottom + GAP}px`;
    node.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - GAP - 16)}px`;
  }

  function visual(option, size = 20) {
    if (!option) return null;
    if (option.avatarUrl !== undefined) return avatar({ login: option.label, avatarUrl: option.avatarUrl }, size);
    if (option.color) return element('span', { className: 'ghs-menu-swatch', attributes: { style: `background:#${option.color}` } });
    if (option.icon) return octicon(option.icon);
    return null;
  }

  function onOutsidePress(isInside, close) {
    document.addEventListener('mousedown', (event) => {
      if (!isInside(event.target)) close();
    });
  }

  // A single-choice menu, for sort.
  class Menu {
    constructor() {
      this.list = element('ul', { className: 'ghs-menu-options', attributes: { role: 'listbox', tabindex: '0', 'aria-label': 'Sort by' } });
      this.title = element('div', { className: 'ghs-menu-title' });
      this.node = element('div', { className: 'ghs-floating ghs-menu ghs-menu--compact', attributes: { role: 'dialog' } }, [this.title, this.list]);
      this.node.addEventListener('mousedown', (event) => event.preventDefault());
      this.list.addEventListener('keydown', (event) => this.keydown(event));
      onOutsidePress((target) => !this.spec || this.node.contains(target) || (this.anchor && this.anchor.contains(target)), () => this.close());
      window.addEventListener('resize', () => this.position(), { passive: true });
      window.addEventListener('scroll', () => this.position(), { passive: true, capture: true });
    }

    open(spec, anchor) {
      this.spec = spec;
      this.anchor = anchor;
      this.active = Math.max(0, spec.options.findIndex((option) => option.value === spec.value));
      this.title.textContent = spec.title;
      anchor.setAttribute('aria-expanded', 'true');
      document.body.append(this.node);
      this.render();
      this.position();
      this.list.focus({ preventScroll: true });
    }

    close({ focusAnchor = false } = {}) {
      if (!this.spec) return;
      this.anchor.setAttribute('aria-expanded', 'false');
      if (focusAnchor && this.anchor.isConnected) this.anchor.focus();
      this.spec = null;
      this.node.remove();
    }

    position() {
      if (this.spec && this.anchor.isConnected) place(this.node, this.anchor);
    }

    render() {
      this.list.replaceChildren(
        ...this.spec.options.map((option, index) => {
          const selected = option.value === this.spec.value;
          const item = element('li', { className: `ghs-menu-option${index === this.active ? ' is-active' : ''}`, attributes: { role: 'option', 'aria-selected': String(selected) } }, [
            element('span', { className: 'ghs-menu-check' }, selected ? octicon('check') : null),
            element('span', { className: 'ghs-menu-text' }, element('span', { className: 'ghs-menu-label', text: option.label })),
          ]);
          item.addEventListener('click', () => this.choose(option));
          return item;
        }),
      );
    }

    choose(option) {
      const spec = this.spec;
      this.close({ focusAnchor: true });
      spec.onChange(option.value);
    }

    keydown(event) {
      const count = this.spec.options.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.active = (this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
        this.render();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.choose(this.spec.options[this.active]);
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        this.close({ focusAnchor: true });
      }
    }
  }

  // Edits one token: is or is not, and its values, applied together.
  class TokenEditor {
    constructor() {
      this.heading = element('div', { className: 'ghs-editor-heading' });
      this.operators = element('div', { className: 'ghs-editor-operators', attributes: { role: 'radiogroup', 'aria-label': 'Operator' } });
      this.input = element('input', { className: 'ghs-menu-filter', attributes: { type: 'text', autocomplete: 'off', spellcheck: 'false' } });
      this.list = element('ul', { className: 'ghs-menu-options', attributes: { role: 'listbox', 'aria-multiselectable': 'true', tabindex: '0', 'aria-label': 'Values' } });
      this.removeButton = element('button', { className: 'ghs-editor-remove', text: 'Remove', attributes: { type: 'button' } });
      this.cancelButton = element('button', { className: 'ghs-button ghs-button--small', text: 'Cancel', attributes: { type: 'button' } });
      this.applyButton = element('button', { className: 'ghs-button ghs-button--small ghs-button--primary', text: 'Apply', attributes: { type: 'button' } });
      this.node = element('div', { className: 'ghs-floating ghs-menu ghs-editor', attributes: { role: 'dialog' } }, [
        this.heading,
        this.operators,
        this.input,
        this.list,
        element('div', { className: 'ghs-editor-footer' }, [this.removeButton, element('span', { className: 'ghs-editor-hint', text: 'Space picks · ↵ applies' }), this.cancelButton, this.applyButton]),
      ]);
      this.input.addEventListener('input', () => {
        this.active = 0;
        this.renderOptions();
      });
      this.input.addEventListener('keydown', (event) => this.keydown(event));
      this.list.addEventListener('keydown', (event) => this.keydown(event));
      this.node.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          this.apply();
        }
      });
      this.removeButton.addEventListener('click', () => this.finish(this.spec.onRemove));
      this.cancelButton.addEventListener('click', () => this.close());
      this.applyButton.addEventListener('click', () => this.apply());
      // Only the panel itself counts as inside: a new filter's editor is anchored to the whole bar.
      onOutsidePress((target) => !this.spec || this.node.contains(target), () => this.close({ restoreFocus: false }));
      window.addEventListener('resize', () => this.position(), { passive: true });
      window.addEventListener('scroll', () => this.position(), { passive: true, capture: true });
    }

    isOpen() {
      return Boolean(this.spec);
    }

    // spec: { field, negated, values, options(), onApply(negated, values), onRemove, returnFocus }
    open(spec, anchor) {
      this.spec = spec;
      this.anchor = anchor;
      this.negated = spec.negated;
      this.values = [...spec.values];
      this.active = 0;
      const { field } = spec;
      const textual = field.type === 'text';
      this.heading.replaceChildren(octicon(field.icon), element('span', { className: 'ghs-editor-title', text: field.label }), element('span', { className: 'ghs-editor-description', text: field.description || '' }));
      this.input.value = textual ? (field.key === null ? search.formatToken(null, this.values) : this.values.join(',')) : '';
      this.input.placeholder = textual ? (field.key === null ? 'Words to search for' : 'Value, as on GitHub') : 'Filter or type a value';
      this.input.setAttribute('aria-label', textual ? field.label : `Filter ${field.label.toLowerCase()}`);
      this.input.hidden = field.type === 'enum';
      this.list.hidden = textual;
      this.removeButton.hidden = !spec.onRemove;
      this.node.setAttribute('aria-label', `${spec.onRemove ? 'Change' : 'Add'} the ${field.label} filter`);
      this.renderOperators();
      document.body.append(this.node);
      this.renderOptions();
      this.position();
      (field.type === 'enum' ? this.list : this.input).focus({ preventScroll: true });
      if (textual) this.input.select();
    }

    close({ restoreFocus = true } = {}) {
      if (!this.spec) return;
      const spec = this.spec;
      this.spec = null;
      this.node.remove();
      if (restoreFocus && spec.returnFocus) spec.returnFocus();
    }

    finish(action) {
      const spec = this.spec;
      this.close({ restoreFocus: false });
      action();
      if (spec.returnFocus) spec.returnFocus();
    }

    position() {
      if (this.spec && this.anchor.isConnected) place(this.node, this.anchor);
    }

    renderOperators() {
      const [positive, negative] = operatorChoices(this.spec.field);
      this.operators.replaceChildren(
        ...[
          [false, positive],
          [true, negative],
        ].map(([negated, label]) => {
          const selected = this.negated === negated;
          const button = element('button', { className: `ghs-editor-operator${selected ? ' is-selected' : ''}`, text: label, attributes: { type: 'button', role: 'radio', 'aria-checked': String(selected) } });
          button.addEventListener('mousedown', (event) => event.preventDefault());
          button.addEventListener('click', () => {
            this.negated = negated;
            this.renderOperators();
          });
          return button;
        }),
      );
    }

    currentOptions() {
      const typed = this.input.value.trim();
      const needle = typed.toLowerCase();
      const options = this.spec.options();
      const chosen = new Set(this.values.map((value) => value.toLowerCase()));
      const known = new Set(options.map((option) => option.value.toLowerCase()));
      // Values picked or typed that the loaded pull requests do not have stay listed, so they can be unticked.
      const extra = this.values.filter((value) => !known.has(value.toLowerCase())).map((value) => ({ value, label: value, count: 0 }));
      let shown = [...extra, ...options];
      if (needle) shown = shown.filter((option) => `${option.label} ${option.value} ${option.detail || ''}`.toLowerCase().includes(needle));
      if (needle && this.spec.field.type === 'entity' && !known.has(needle) && !chosen.has(needle)) shown.push({ value: typed, label: `Use “${typed}”`, icon: 'filter', typed: true });
      return shown;
    }

    renderOptions() {
      this.applyButton.disabled = false;
      if (this.spec.field.type === 'text') return;
      const options = this.currentOptions();
      this.options = options;
      this.active = Math.min(this.active, Math.max(0, options.length - 1));
      const chosen = new Set(this.values.map((value) => value.toLowerCase()));
      this.list.replaceChildren(
        ...options.map((option, index) => {
          const selected = !option.typed && chosen.has(option.value.toLowerCase());
          const item = element(
            'li',
            {
              className: `ghs-menu-option${index === this.active ? ' is-active' : ''}${option.count === 0 && !selected ? ' is-empty' : ''}`,
              attributes: { id: `ghs-editor-option-${index}`, role: 'option', 'aria-selected': String(selected) },
            },
            [
              element('span', { className: 'ghs-menu-check' }, selected ? octicon('check') : null),
              visual(option),
              element('span', { className: 'ghs-menu-text' }, [
                element('span', { className: 'ghs-menu-label', text: option.label }),
                option.detail ? element('span', { className: 'ghs-menu-detail', text: option.detail }) : null,
              ]),
              option.count === undefined ? null : element('span', { className: 'ghs-menu-count', text: String(option.count) }),
            ],
          );
          item.addEventListener('mousedown', (event) => event.preventDefault());
          item.addEventListener('click', () => this.toggle(option));
          item.addEventListener('mousemove', () => {
            if (this.active !== index) this.setActive(index);
          });
          return item;
        }),
      );
      if (options.length === 0) this.list.append(element('li', { className: 'ghs-menu-empty', text: 'Nothing matches' }));
      (this.input.hidden ? this.list : this.input).setAttribute('aria-activedescendant', options.length > 0 ? `ghs-editor-option-${this.active}` : '');
      this.applyButton.disabled = this.values.length === 0 && !this.spec.onRemove;
    }

    setActive(index) {
      const items = this.list.querySelectorAll('.ghs-menu-option');
      if (items[this.active]) items[this.active].classList.remove('is-active');
      this.active = index;
      if (items[index]) {
        items[index].classList.add('is-active');
        items[index].scrollIntoView({ block: 'nearest' });
      }
      (this.input.hidden ? this.list : this.input).setAttribute('aria-activedescendant', `ghs-editor-option-${index}`);
    }

    toggle(option) {
      const lowered = option.value.toLowerCase();
      if (this.values.some((value) => value.toLowerCase() === lowered)) this.values = this.values.filter((value) => value.toLowerCase() !== lowered);
      else this.values = [...this.values, option.value];
      if (option.typed) this.input.value = '';
      this.renderOptions();
    }

    keydown(event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return;
      if (this.spec.field.type === 'text') {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.apply();
        }
        return;
      }
      const count = this.options ? this.options.length : 0;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (count > 0) this.setActive((this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      } else if (event.key === ' ' && event.target === this.list) {
        event.preventDefault();
        if (count > 0) this.toggle(this.options[this.active]);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        // Typing in the filter box, Enter picks the highlighted value and keeps the editor open for more.
        // Otherwise Enter applies, picking the highlighted value first when nothing is picked yet.
        const typing = event.target === this.input && this.input.value.trim() !== '';
        if (typing) {
          if (count > 0) this.toggle(this.options[this.active]);
          return;
        }
        if (this.values.length === 0 && count > 0) this.toggle(this.options[this.active]);
        this.apply();
      }
    }

    apply() {
      let values = this.values;
      if (this.spec.field.type === 'text') {
        const typed = this.input.value.trim();
        values = this.spec.field.key === null ? search.tokenize(typed).map((token) => (token.key ? token.raw : token.value)).filter(Boolean) : typed ? [typed] : [];
      }
      const { negated } = this;
      if (values.length === 0) {
        if (this.spec.onRemove) this.finish(this.spec.onRemove);
        else this.close();
        return;
      }
      const { onApply } = this.spec;
      this.finish(() => onApply(negated, values));
    }
  }

  // The search: a bar of filter tokens with a typeahead, and the state tabs, quick filters and sort under it.
  class SearchBar {
    constructor() {
      this.model = null;
      this.armed = false;
      this.currentTokens = [];
      this.input = element('input', {
        className: 'ghs-search-input',
        attributes: {
          type: 'text',
          role: 'combobox',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': 'Search or add a filter',
          'aria-autocomplete': 'list',
          'aria-expanded': 'false',
          'aria-controls': 'ghs-typeahead',
        },
      });
      this.tokens = element('div', { className: 'ghs-tokens', attributes: { role: 'list', 'aria-label': 'Filters' } });
      this.clearButton = element('button', { className: 'ghs-search-clear', attributes: { type: 'button', 'aria-label': 'Remove every filter', title: 'Remove every filter' } }, octicon('x-circle-fill'));
      this.clearButton.addEventListener('click', () => {
        this.input.value = '';
        this.model.onDraft('');
        this.model.onQuery(search.clearFilters(this.model.query));
        this.input.focus();
      });
      this.field = element('div', { className: 'ghs-power' }, [
        octicon('search', 'ghs-search-icon'),
        this.tokens,
        this.input,
        this.clearButton,
        element('kbd', { className: 'ghs-search-key', text: '/', attributes: { title: 'Press / to search' } }),
      ]);
      this.field.addEventListener('mousedown', (event) => {
        if (event.target === this.field || event.target === this.tokens || event.target.closest('.ghs-search-icon')) {
          event.preventDefault();
          this.input.focus();
        }
      });
      this.bar = element('div', { className: 'ghs-filter-bar', attributes: { role: 'toolbar', 'aria-label': 'State, quick filters and sort' } });
      this.status = element('div', { className: 'ghs-visually-hidden', attributes: { role: 'status', 'aria-live': 'polite' } });
      this.node = element('div', { className: 'ghs-search', attributes: { role: 'search' } }, [this.field, this.bar, this.status]);
      this.typeahead = element('ul', { className: 'ghs-floating ghs-suggestions', attributes: { id: 'ghs-typeahead', role: 'listbox', 'aria-label': 'Filters and suggestions' } });
      this.typeahead.addEventListener('mousedown', (event) => event.preventDefault());
      this.menu = new Menu();
      this.editor = new TokenEditor();
      this.bindInput();
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target) || !this.node.isConnected || !this.node.offsetParent) return;
          event.preventDefault();
          event.stopPropagation();
          this.input.focus();
        },
        true,
      );
      window.addEventListener('resize', () => this.positionTypeahead(), { passive: true });
      window.addEventListener('scroll', () => this.positionTypeahead(), { passive: true, capture: true });
    }

    bindInput() {
      const input = this.input;
      input.addEventListener('input', () => {
        this.disarm();
        this.model.onDraft(input.value);
        this.showTypeahead(false);
      });
      input.addEventListener('focus', () => this.showTypeahead(input.value.trim() === ''));
      input.addEventListener('click', () => this.showTypeahead(true));
      input.addEventListener('blur', () => {
        this.hideTypeahead();
        this.disarm();
      });
      input.addEventListener('keydown', (event) => {
        const open = Boolean(this.items && this.items.length > 0);
        const empty = input.value === '';
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) this.showTypeahead(true);
          else this.setActiveItem(this.activeItem === -1 ? 0 : (this.activeItem + (event.key === 'ArrowDown' ? 1 : this.items.length - 1)) % this.items.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (open && this.activeItem !== -1) this.choose(this.items[this.activeItem]);
          else if (input.value.trim()) this.addDraft();
        } else if (event.key === 'Tab' && open && !event.shiftKey && input.value.trim() && this.activeItem !== -1) {
          event.preventDefault();
          this.choose(this.items[this.activeItem]);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (open) this.hideTypeahead();
          else if (!empty) this.clearDraft();
          else input.blur();
        } else if (event.key === 'Backspace' && empty) {
          if (this.currentTokens.length === 0) return;
          event.preventDefault();
          if (this.armed) this.removeToken(this.currentTokens.length - 1, { focus: 'input' });
          else this.arm();
        } else if (event.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
          const buttons = this.tokens.querySelectorAll('.ghs-token-body');
          if (buttons.length === 0) return;
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else this.disarm();
      });
    }

    arm() {
      const tokens = this.tokens.querySelectorAll('.ghs-token');
      this.armed = true;
      tokens[tokens.length - 1].classList.add('is-armed');
      this.status.textContent = 'Press Backspace again to remove the last filter';
    }

    disarm() {
      if (!this.armed) return;
      this.armed = false;
      for (const token of this.tokens.querySelectorAll('.is-armed')) token.classList.remove('is-armed');
    }

    // Typeahead: what can be added from the text typed so far.
    buildItems(explicit) {
      const model = this.model;
      const draft = this.input.value;
      const text = draft.trim();
      if (!text) {
        if (!explicit) return [];
        return FIELDS.filter((field) => field.key !== null).map((field) => ({ kind: 'field', field, label: field.label, detail: field.description, icon: field.icon }));
      }
      const tokens = search.tokenize(text);
      if (tokens.some((token) => token.key !== null)) {
        // Typed as GitHub search syntax: complete the qualifier, or add it as typed.
        const suggestion = /\s$/.test(draft) ? null : search.suggest(draft, draft.length, model.vocabulary);
        const items = (suggestion ? suggestion.items : []).map((entry) => ({
          kind: entry.complete ? 'completion' : 'key',
          insert: draft.slice(0, suggestion.start) + entry.insert,
          label: entry.label,
          detail: entry.detail,
          avatarUrl: entry.avatarUrl,
          color: entry.color,
          mono: true,
        }));
        if (tokens.every((token) => search.classify(token) !== 'ignore')) items.push({ kind: 'commit', label: `Add ${text}`, detail: 'As typed', icon: 'filter', mono: true });
        return items;
      }
      const word = text.toLowerCase();
      const items = [
        {
          kind: 'commit',
          label: `Search for “${text}”`,
          detail: model.truncated ? `All ${model.truncated.toLocaleString()} on GitHub, in titles, bodies and comments` : 'In titles, numbers, branches, authors and labels',
          icon: 'search',
        },
      ];
      for (const field of FIELDS) {
        if (field.key !== null && (field.label.toLowerCase().startsWith(word) || field.key.startsWith(word))) items.push({ kind: 'field', field, label: field.label, detail: field.description, icon: field.icon });
      }
      const matches = [];
      for (const field of FIELDS) {
        if (field.key === null || field.key === 'involves' || field.type === 'text') continue;
        const found = model
          .options(field.key)
          .filter((option) => option.value !== '@me' && `${option.label} ${option.value}`.toLowerCase().includes(word))
          .sort((left, right) => (right.count || 0) - (left.count || 0))
          .slice(0, MAXIMUM_MATCHES_PER_FIELD);
        const words = describe(field, false, 1);
        for (const option of found) {
          matches.push({ kind: 'value', field, value: option.value, label: option.label, prefix: `${words.label} ${words.operator}`.trim(), count: option.count, avatarUrl: option.avatarUrl, color: option.color, icon: option.icon || field.icon });
        }
      }
      // Exact and leading matches first, then the most common.
      const rank = (match) => (match.label.toLowerCase() === word ? 0 : match.label.toLowerCase().startsWith(word) ? 1 : 2);
      // Values that would show nothing with the other filters still come, after the rest.
      matches.sort((left, right) => (right.count > 0) - (left.count > 0) || rank(left) - rank(right) || right.count - left.count);
      return [...items, ...matches.slice(0, MAXIMUM_VALUE_MATCHES)];
    }

    showTypeahead(explicit) {
      if (!this.model || document.activeElement !== this.input || this.editor.isOpen()) return;
      const items = this.buildItems(explicit);
      if (items.length === 0) {
        this.hideTypeahead();
        return;
      }
      const typed = this.input.value.trim() !== '';
      this.items = items;
      this.activeItem = typed ? 0 : -1;
      const nodes = [];
      let section = null;
      items.forEach((item, index) => {
        const name = item.kind === 'value' ? 'Matching values' : item.kind === 'field' ? (typed ? 'Filter by' : 'Add a filter') : null;
        if (name && name !== section) nodes.push(element('li', { className: 'ghs-suggestion-section', text: name, attributes: { role: 'presentation' } }));
        if (name) section = name;
        const node = element('li', { className: `ghs-suggestion${index === this.activeItem ? ' is-active' : ''}`, attributes: { id: `ghs-typeahead-${index}`, role: 'option', 'aria-selected': String(index === this.activeItem) } }, [
          visual(item) || octicon('filter', 'ghs-suggestion-icon'),
          item.prefix ? element('span', { className: 'ghs-suggestion-prefix', text: item.prefix }) : null,
          element('span', { className: `ghs-suggestion-label${item.mono ? ' is-mono' : ''}`, text: item.label }),
          item.detail ? element('span', { className: 'ghs-suggestion-detail', text: item.detail }) : null,
          item.count !== undefined ? element('span', { className: 'ghs-menu-count', text: String(item.count) }) : null,
          item.kind === 'field' ? octicon('chevron-right', 'ghs-suggestion-more') : null,
        ]);
        node.addEventListener('click', () => this.choose(item));
        node.addEventListener('mousemove', () => {
          if (this.activeItem !== index) this.setActiveItem(index);
        });
        nodes.push(node);
      });
      nodes.push(
        element('li', { className: 'ghs-suggestion-help', attributes: { 'aria-hidden': 'true' } }, [
          element('kbd', { text: '↑↓' }),
          ' choose ',
          element('kbd', { text: '↵' }),
          ' add ',
          element('kbd', { text: '⌫' }),
          ' remove the last filter ',
          element('kbd', { text: 'esc' }),
          ' close',
        ]),
      );
      this.typeahead.replaceChildren(...nodes);
      if (!this.typeahead.isConnected) document.body.append(this.typeahead);
      this.input.setAttribute('aria-expanded', 'true');
      if (this.activeItem === -1) this.input.removeAttribute('aria-activedescendant');
      else this.input.setAttribute('aria-activedescendant', `ghs-typeahead-${this.activeItem}`);
      this.positionTypeahead();
    }

    positionTypeahead() {
      if (this.typeahead.isConnected) place(this.typeahead, this.field, { width: true });
    }

    setActiveItem(index) {
      const nodes = this.typeahead.querySelectorAll('.ghs-suggestion');
      if (nodes[this.activeItem]) {
        nodes[this.activeItem].classList.remove('is-active');
        nodes[this.activeItem].setAttribute('aria-selected', 'false');
      }
      this.activeItem = index;
      nodes[index].classList.add('is-active');
      nodes[index].setAttribute('aria-selected', 'true');
      nodes[index].scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', `ghs-typeahead-${index}`);
    }

    hideTypeahead() {
      this.items = null;
      this.activeItem = -1;
      this.typeahead.remove();
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
    }

    clearDraft() {
      this.input.value = '';
      this.model.onDraft('');
    }

    addDraft() {
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = '';
      this.hideTypeahead();
      this.model.onAddDraft(text);
    }

    choose(item) {
      if (item.kind === 'commit') this.addDraft();
      else if (item.kind === 'key') {
        this.input.value = item.insert;
        this.model.onDraft(item.insert);
        this.showTypeahead(true);
      } else if (item.kind === 'completion') {
        this.input.value = item.insert;
        this.addDraft();
      } else if (item.kind === 'field') {
        this.clearDraft();
        this.openEditor({ field: item.field, negated: false, values: [] }, this.field, null);
      } else if (item.kind === 'value') {
        this.clearDraft();
        this.hideTypeahead();
        this.model.onQuery(search.replaceTokens(this.model.query, [], [search.formatToken(item.field.key, [item.value])]));
        this.input.focus();
      }
    }

    // Opens the editor on a token, or for a new one when token is null.
    openEditor({ field, negated, values }, anchor, token) {
      const model = this.model;
      const starts = token ? token.parts.map((part) => part.start) : [];
      const index = token ? this.currentTokens.indexOf(token) : -1;
      this.hideTypeahead();
      this.editor.open(
        {
          field,
          negated,
          values,
          options: () => (field.type === 'text' ? [] : this.model.options(field.key)),
          onApply: (nextNegated, nextValues) => model.onQuery(search.replaceTokens(model.query, starts, [search.formatToken(field.key, nextValues, nextNegated)])),
          onRemove: token ? () => model.onQuery(search.replaceTokens(model.query, starts, [])) : null,
          returnFocus: () => {
            const buttons = this.tokens.querySelectorAll('.ghs-token-body');
            if (index !== -1 && buttons[index]) buttons[index].focus();
            else this.input.focus();
          },
        },
        anchor,
      );
    }

    removeToken(index, { focus } = {}) {
      const token = this.currentTokens[index];
      this.armed = false;
      this.model.onQuery(search.replaceTokens(this.model.query, token.parts.map((part) => part.start), []));
      const buttons = this.tokens.querySelectorAll('.ghs-token-body');
      if (focus === 'input' || buttons.length === 0) this.input.focus();
      else buttons[Math.max(0, Math.min(index - 1, buttons.length - 1))].focus();
    }

    close() {
      this.hideTypeahead();
      this.menu.close();
      this.editor.close({ restoreFocus: false });
    }

    update(model) {
      this.model = model;
      if (this.input.value !== model.draft) this.input.value = model.draft;
      const focusKey = document.activeElement && this.node.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      this.renderTokens(model);
      this.renderBar(model);
      this.clearButton.hidden = !model.clearable;
      this.input.placeholder = this.currentTokens.length > 0 ? 'Add a filter or search' : 'Search, or filter by author, label, review, checks…';
      this.status.textContent = model.summary || '';
      if (focusKey) {
        const next = this.node.querySelector(`[data-focus-key="${focusKey}"]`);
        if (next) next.focus({ preventScroll: true });
      }
      if (document.activeElement === this.input && this.items) this.showTypeahead(false);
    }

    renderTokens(model) {
      const tokens = tokensOf(model.query);
      this.currentTokens = tokens;
      this.armed = false;
      this.tokens.replaceChildren(
        ...tokens.map((token, index) => {
          const words = describe(token.field, token.negated, token.values.length);
          const labels = token.values.map((value) => model.labelFor(token.field.key, value));
          const single = token.values.length === 1 ? model.lookup(token.field.key, token.values[0]) : null;
          const raw = token.parts.map((part) => part.raw).join(' ');
          const value = token.field.key === null ? labels.map((label) => (/\s/.test(label) ? `“${label}”` : label)).join(' ') : labels.join(', ');
          const description = `${words.label} ${words.operator} ${value}`.replace(/\s+/g, ' ').trim();
          const body = element(
            'button',
            {
              className: 'ghs-token-body',
              attributes: { type: 'button', 'data-focus-key': `token-${index}`, title: `${raw}\nClick to change`, 'aria-label': `${description}. Enter to change, Backspace to remove` },
            },
            [
              single && (single.avatarUrl !== undefined || single.color) ? visual(single, 16) : octicon((single && single.icon) || token.field.icon, 'ghs-token-icon'),
              element('span', { className: 'ghs-token-field', text: words.label }),
              words.operator ? element('span', { className: 'ghs-token-operator', text: words.operator }) : null,
              element('span', { className: 'ghs-token-value', text: value }),
            ],
          );
          body.addEventListener('click', () => this.openEditor({ field: token.field, negated: token.negated, values: token.values }, body, token));
          body.addEventListener('keydown', (event) => {
            const buttons = [...this.tokens.querySelectorAll('.ghs-token-body')];
            if (event.key === 'ArrowLeft' && index > 0) {
              event.preventDefault();
              buttons[index - 1].focus();
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              if (buttons[index + 1]) buttons[index + 1].focus();
              else this.input.focus();
            } else if (event.key === 'Backspace' || event.key === 'Delete') {
              event.preventDefault();
              this.removeToken(index);
            }
          });
          const remove = element('button', { className: 'ghs-token-remove', attributes: { type: 'button', tabindex: '-1', 'aria-label': `Remove ${description}`, title: 'Remove' } }, octicon('x'));
          remove.addEventListener('click', () => this.removeToken(index, { focus: 'input' }));
          return element('span', { className: `ghs-token${token.negated ? ' is-negated' : ''}`, attributes: { role: 'listitem' } }, [body, remove]);
        }),
      );
    }

    renderBar(model) {
      this.bar.replaceChildren(
        element('div', { className: 'ghs-state-tabs', attributes: { role: 'group', 'aria-label': 'State' } }, STATE_TABS.map((tab) => this.stateTab(tab, model))),
        model.chips.length > 0 ? element('div', { className: 'ghs-quick-filters', attributes: { role: 'group', 'aria-label': 'Quick filters' } }, model.chips.map((chip) => this.chip(chip))) : null,
        this.sortButton(model.sort),
      );
    }

    stateTab(tab, model) {
      const selected = tab.states.length === model.states.size && tab.states.every((state) => model.states.has(state));
      const count = model.stateCounts ? model.stateCounts[tab.id] : null;
      const node = element(
        'button',
        { className: `ghs-state-tab${selected ? ' is-selected' : ''}`, attributes: { type: 'button', 'aria-pressed': String(selected), title: tab.title, 'data-focus-key': `state-${tab.id}` } },
        [tab.label, count === null || count === undefined ? null : element('span', { className: 'ghs-state-count', text: count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count) })],
      );
      node.addEventListener('click', () => model.onStates(tab.states));
      return node;
    }

    chip(chip) {
      const node = element(
        'button',
        { className: `ghs-chip${chip.active ? ' is-active' : ''}`, attributes: { type: 'button', 'aria-pressed': String(chip.active), title: chip.title, 'data-focus-key': `chip-${chip.id}` } },
        [chip.icon ? octicon(chip.icon) : null, chip.label, chip.count === undefined ? null : element('span', { className: 'ghs-chip-count', text: String(chip.count) })],
      );
      node.addEventListener('click', chip.onToggle);
      return node;
    }

    sortButton(sort) {
      const node = element(
        'button',
        { className: 'ghs-menu-button ghs-sort-button', attributes: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-focus-key': 'sort', title: 'Sort pull requests' } },
        [octicon('sort-desc'), element('span', { className: 'ghs-menu-button-label', text: 'Sort' }), element('span', { className: 'ghs-menu-button-value', text: sort.label }), octicon('triangle-down', 'ghs-menu-caret')],
      );
      node.addEventListener('click', () => {
        if (this.menu.spec) this.menu.close();
        else this.menu.open({ title: 'Sort by', value: sort.value, options: sort.options, onChange: sort.onChange }, node);
      });
      return node;
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { SearchBar });
})(globalThis);
