(function (root) {
  const { ListView, IssueListView, StackNavigator, api } = root.GitHubStacks;

  const LIST_PATH = /^\/([^/]+)\/([^/]+)\/pulls(?:\/.*)?$/;
  const PULL_REQUEST_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/]+))?/;
  const ISSUES_PATH = /^\/([^/]+)\/([^/]+)\/issues\/?$/;

  function currentRoute() {
    const where = root.GitHubStacks.testLocation || location;
    const list = where.pathname.match(LIST_PATH);
    if (list) return { kind: 'list', host: where.host, owner: list[1], repository: list[2] };
    const issues = where.pathname.match(ISSUES_PATH);
    if (issues) return { kind: 'issues', host: where.host, owner: issues[1], repository: issues[2] };
    const pullRequest = where.pathname.match(PULL_REQUEST_PATH);
    if (pullRequest) {
      return { kind: 'pull_request', host: where.host, owner: pullRequest[1], repository: pullRequest[2], number: Number(pullRequest[3]), tab: pullRequest[4] || null };
    }
    return { kind: 'other' };
  }

  const listView = new ListView();
  const issueView = new IssueListView();
  const navigator = new StackNavigator();

  function sync() {
    const route = currentRoute();
    if (route.kind === 'list') listView.sync(route);
    else listView.unmount();
    if (route.kind === 'issues') issueView.sync(route);
    else issueView.unmount();
    if (route.kind === 'pull_request') navigator.sync(route);
    else navigator.unmount();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  for (const event of ['turbo:load', 'turbo:render', 'popstate', 'pageshow']) window.addEventListener(event, schedule);
  document.addEventListener('turbo:load', schedule);
  if (api.extensionAlive()) chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.tokens) {
      listView.key = null;
      issueView.key = null;
      navigator.key = null;
      schedule();
    }
  });
  schedule();
})(globalThis);
