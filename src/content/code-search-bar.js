(function (root) {
  const { octicon, api, codeSearch } = root.GitHubStacks;
  const { element } = root.GitHubStacks.render;

  // Where the box goes: at the top of the column that holds the branch picker and the list of files, found by test
  // ids and ids rather than class names, which GitHub changes.
  function findAnchor() {
    const files = document.querySelector('[data-testid="directory-content"], [data-testid="latest-commit-details"]');
    if (!files) return null;
    const picker = document.querySelector('[id^="ref-picker-repos-header"], [id^="branch-picker-repos-header"], button.overview-ref-selector');
    if (!picker) return { parent: files.parentElement, before: files };
    let column = picker;
    while (column && !column.contains(files)) column = column.parentElement;
    if (!column || column === document.body) return { parent: files.parentElement, before: files };
    return { parent: column, before: column.firstElementChild };
  }

  // A search box for the repository's code, at the top of its main page.
  class CodeSearchBar {
    constructor() {
      this.input = element('input', {
        className: 'ghs-code-search-input',
        attributes: { type: 'search', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' },
      });
      this.hint = element('span', { className: 'ghs-code-search-hint', attributes: { 'aria-hidden': 'true' } }, [element('kbd', { text: '↵' }), ' Search code']);
      this.form = element('form', { className: 'ghs-code-search-form', attributes: { role: 'search' } }, [
        element('label', { className: 'ghs-code-search-field' }, [octicon('search', 'ghs-code-search-icon'), this.input, this.hint]),
      ]);
      this.shortcut = element('div', { className: 'ghs-code-search-shortcut' });
      this.node = element('section', { className: 'ghs-code-search', attributes: { 'aria-label': 'Search code' } }, [this.form, this.shortcut]);
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.search(false);
      });
      // Enter searches here; with ⌘ or Ctrl, in a new tab.
      this.input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        this.search(event.metaKey || event.ctrlKey);
      });
    }

    search(newTab) {
      const words = this.input.value.trim();
      if (!words || !this.route) return;
      const url = codeSearch.codeSearchUrl(this.route.host, `${this.route.owner}/${this.route.repository}`, words);
      if (newTab) window.open(url, '_blank');
      else location.assign(url);
    }

    // Returns whether the box is on the page, which also says the route really is a repository.
    sync(route) {
      const anchor = findAnchor();
      if (!anchor) {
        this.unmount();
        return false;
      }
      const repository = `${route.owner}/${route.repository}`;
      if (!this.route || this.key !== `${route.host}/${repository}`) {
        this.route = route;
        this.key = `${route.host}/${repository}`;
        this.input.value = '';
        this.input.placeholder = `Search code in ${repository}`;
        this.input.setAttribute('aria-label', `Search code in ${repository}`);
        this.renderShortcut();
      }
      if (this.node.parentElement !== anchor.parent) anchor.parent.insertBefore(this.node, anchor.before);
      return true;
    }

    async renderShortcut() {
      const key = this.key;
      const { host } = this.route;
      const repository = `${this.route.owner}/${this.route.repository}`;
      const saved = await api.readLocal('codeSearch', {});
      if (key !== this.key) return;
      const mine = saved.host === host && saved.repository === repository;
      const keyword = element('kbd', { text: `${codeSearch.KEYWORD} ␣` });
      const tip = mine
        ? ['Type ', keyword, ' in Chrome’s address bar to search this code from any tab.']
        : ['Type ', keyword, ' in Chrome’s address bar to search ', saved.repository ? saved.repository : 'the last repository you visited', ' from any tab.'];
      const use = mine
        ? null
        : element('button', { className: 'ghs-code-search-use', text: `Always search ${repository}`, attributes: { type: 'button', title: `Make ${codeSearch.KEYWORD} search ${repository}` } });
      if (use) {
        use.addEventListener('click', async () => {
          await api.writeLocal({ codeSearch: { host, repository } });
          this.renderShortcut();
        });
      }
      this.shortcut.replaceChildren(...[element('span', {}, tip), use].filter(Boolean));
    }

    unmount() {
      this.node.remove();
      this.route = null;
      this.key = null;
    }
  }

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { CodeSearchBar });
})(globalThis);
