(function (root) {
  // Searching a repository's code on GitHub, from the box on a repository page and from the address bar, where
  // `tbgs` and a space start a search (like bunnylol). Which host and repository the address bar searches comes from
  // the settings, or else the last repository visited.

  const KEYWORD = 'tbgs';
  const HOST_PATTERN = /^(github\.com|[a-z0-9-]+\.ghe\.com)$/;
  const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

  function validHost(host) {
    return typeof host === 'string' && HOST_PATTERN.test(host);
  }

  function validRepository(repository) {
    return typeof repository === 'string' && REPOSITORY_PATTERN.test(repository);
  }

  // GitHub's code search for words, in one repository when given, as GitHub writes the URL (spaces as +).
  function codeSearchUrl(host, repository, words) {
    const q = [validRepository(repository) ? `repo:${repository}` : null, words.trim()].filter(Boolean).join(' ');
    return `https://${host}/search?${new URLSearchParams({ q, type: 'code' })}`;
  }

  // saved: { host, repository } from the settings, either may be empty. recent: { lastHost, repositories: { host: 'owner/name' } }.
  function codeSearchTarget(saved = {}, recent = {}) {
    const repositories = recent.repositories || {};
    const host = validHost(saved.host) ? saved.host : validHost(recent.lastHost) ? recent.lastHost : 'github.com';
    const chosen = validRepository(saved.repository) ? saved.repository : null;
    const repository = chosen || (validRepository(repositories[host]) ? repositories[host] : null);
    return { host, repository, fromSettings: Boolean(chosen) };
  }

  const api = { codeSearch: { KEYWORD, validHost, validRepository, codeSearchUrl, codeSearchTarget } };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
