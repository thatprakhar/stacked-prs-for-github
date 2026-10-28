const test = require('node:test');
const assert = require('node:assert/strict');
const { codeSearch } = require('../src/shared/code-search.js');

test('builds GitHub code search URLs the way GitHub writes them', () => {
  assert.equal(codeSearch.codeSearchUrl('acme.ghe.com', 'Acme/monorepo', 'xyz'), 'https://acme.ghe.com/search?q=repo%3AAcme%2Fmonorepo+xyz&type=code');
  assert.equal(codeSearch.codeSearchUrl('github.com', 'cli/cli', '  auth token  '), 'https://github.com/search?q=repo%3Acli%2Fcli+auth+token&type=code');
  assert.equal(codeSearch.codeSearchUrl('github.com', null, 'useState'), 'https://github.com/search?q=useState&type=code');
});

test('the address bar searches the repository in the settings, else the last one visited on that host', () => {
  const recent = { lastHost: 'acme.ghe.com', repositories: { 'acme.ghe.com': 'Acme/monorepo', 'github.com': 'cli/cli' } };
  assert.deepEqual(codeSearch.codeSearchTarget({ host: 'github.com', repository: 'octo/site' }, recent), { host: 'github.com', repository: 'octo/site', fromSettings: true });
  assert.deepEqual(codeSearch.codeSearchTarget({ host: 'github.com', repository: '' }, recent), { host: 'github.com', repository: 'cli/cli', fromSettings: false });
  assert.deepEqual(codeSearch.codeSearchTarget({}, recent), { host: 'acme.ghe.com', repository: 'Acme/monorepo', fromSettings: false });
  assert.deepEqual(codeSearch.codeSearchTarget({}, {}), { host: 'github.com', repository: null, fromSettings: false });
  assert.deepEqual(codeSearch.codeSearchTarget({ host: 'evil.example.com', repository: 'not a repo' }, {}), { host: 'github.com', repository: null, fromSettings: false });
});
