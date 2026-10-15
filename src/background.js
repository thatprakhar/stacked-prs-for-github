const SUPPORTED_HOST = /^(github\.com|[a-z0-9-]+\.ghe\.com)$/;

function apiBase(host) {
  return host === 'github.com' ? 'https://api.github.com' : `https://api.${host}`;
}

function senderHost(message, sender) {
  const fromExtensionPage = sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
  const host = fromExtensionPage ? message.host : new URL(sender.tab ? sender.tab.url : sender.url).host;
  if (!SUPPORTED_HOST.test(host)) throw Object.assign(new Error(`Unsupported host ${host}`), { code: 'unsupported_host' });
  return host;
}

async function tokenFor(host) {
  const { tokens = {} } = await chrome.storage.local.get('tokens');
  const token = tokens[host];
  if (!token) throw Object.assign(new Error(`No token saved for ${host}`), { code: 'no_token' });
  return token;
}

async function request(host, path, init = {}) {
  const token = await tokenFor(host);
  const response = await fetch(`${apiBase(host)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (response.status === 401) throw Object.assign(new Error('GitHub rejected the saved token'), { code: 'bad_token' });
  if (response.status === 404) throw Object.assign(new Error(`Not found: ${path}`), { code: 'not_found' });
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}`), { code: 'http_error' });
  return response.json();
}

async function graphql(host, query, variables) {
  const body = await request(host, '/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (body.errors && !body.data) throw Object.assign(new Error(body.errors.map((error) => error.message).join('; ')), { code: 'graphql_error' });
  return body.data;
}

async function handle(message, sender) {
  switch (message.type) {
    case 'graphql':
      return graphql(senderHost(message, sender), message.query, message.variables);
    case 'rest':
      if (!message.path.startsWith('/repos/')) throw new Error('Only repository paths are allowed');
      return request(senderHost(message, sender), message.path);
    case 'open-options': {
      const url = chrome.runtime.getURL(`options/options.html?host=${encodeURIComponent(senderHost(message, sender))}`);
      await chrome.tabs.create({ url });
      return null;
    }
    default:
      throw new Error(`Unknown message ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error.message, code: error.code || 'error' }),
  );
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
