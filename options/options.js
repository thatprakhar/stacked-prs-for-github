const { DEFAULT_SETTINGS } = globalThis.GitHubStacks;
const DEFAULT_HOSTS = ['github.com'];
const HOST_PATTERN = /^(github\.com|[a-z0-9-]+\.ghe\.com)$/;

const tokensElement = document.getElementById('tokens');
const settingsForm = document.getElementById('settings');

async function hosts() {
  const { hosts: saved = [], tokens = {} } = await chrome.storage.local.get(['hosts', 'tokens']);
  return [...new Set([...DEFAULT_HOSTS, ...saved, ...Object.keys(tokens)])];
}

async function addHost(host) {
  const { hosts: saved = [] } = await chrome.storage.local.get('hosts');
  await chrome.storage.local.set({ hosts: [...new Set([...saved, host])] });
}

async function removeHost(host) {
  const { hosts: saved = [] } = await chrome.storage.local.get('hosts');
  await chrome.storage.local.set({ hosts: saved.filter((candidate) => candidate !== host) });
}

async function saveToken(host, token) {
  const { tokens = {} } = await chrome.storage.local.get('tokens');
  if (token) tokens[host] = token;
  else delete tokens[host];
  await chrome.storage.local.set({ tokens });
}

async function testToken(host) {
  const response = await chrome.runtime.sendMessage({ type: 'graphql', host, query: 'query { viewer { login } }', variables: {} });
  if (!response.ok) throw new Error(response.error);
  return response.data.viewer.login;
}

async function renderTokens(focusHost = null) {
  const { tokens = {} } = await chrome.storage.local.get('tokens');
  tokensElement.replaceChildren();
  for (const host of await hosts()) {
    const row = document.createElement('form');
    row.className = 'token-row';
    row.innerHTML = `
      <div class="token-host"><strong></strong><span class="status muted"></span></div>
      <input type="password" autocomplete="off" spellcheck="false" placeholder="Paste a token" />
      <button type="submit" class="button">Save</button>
      <button type="button" class="button" data-action="remove">Remove</button>
      <code class="command" title="Run this to copy a token from the GitHub CLI"></code>`;
    row.querySelector('strong').textContent = host;
    row.querySelector('.command').textContent = `gh auth token --hostname ${host} | pbcopy`;
    row.classList.toggle('is-new', host === focusHost && !tokens[host]);
    const status = row.querySelector('.status');
    const input = row.querySelector('input');
    const remove = row.querySelector('[data-action="remove"]');
    input.setAttribute('aria-label', `Token for ${host}`);
    const removable = !DEFAULT_HOSTS.includes(host);
    remove.hidden = !removable && !tokens[host];
    remove.textContent = removable ? 'Remove host' : 'Remove token';
    const check = async () => {
      if (!tokens[host]) {
        status.textContent = 'No token';
        return;
      }
      status.textContent = 'Checking…';
      try {
        status.textContent = `Signed in as ${await testToken(host)}`;
        status.className = 'status ok';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status error';
      }
    };
    row.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      await saveToken(host, value);
      await renderTokens();
    });
    remove.addEventListener('click', async () => {
      await saveToken(host, null);
      if (removable) await removeHost(host);
      await renderTokens();
    });
    tokensElement.append(row);
    if (host === focusHost && !tokens[host]) input.focus();
    check();
  }
}

document.getElementById('add-host').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('new-host');
  const host = input.value.trim().toLowerCase();
  if (!HOST_PATTERN.test(host)) return;
  await addHost(host);
  input.value = '';
  await renderTokens(host);
});

async function renderSettings() {
  const { settings: saved = {} } = await chrome.storage.sync.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  for (const name of ['slaHours', 'atRiskHours', 'timeZone', 'workdayStart', 'workdayEnd']) settingsForm.elements[name].value = settings[name];
  for (const box of settingsForm.querySelectorAll('input[name="workdays"]')) box.checked = settings.workdays.includes(Number(box.value));
  settingsForm.elements.showNavigator.checked = settings.showNavigator;
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const elements = settingsForm.elements;
  const saved = document.getElementById('saved');
  const timeZone = elements.timeZone.value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    saved.textContent = `${timeZone} is not a time zone`;
    return;
  }
  const settings = {
    slaHours: Number(elements.slaHours.value),
    atRiskHours: Number(elements.atRiskHours.value),
    timeZone,
    workdayStart: Number(elements.workdayStart.value),
    workdayEnd: Number(elements.workdayEnd.value),
    workdays: [...settingsForm.querySelectorAll('input[name="workdays"]:checked')].map((box) => Number(box.value)),
    showNavigator: elements.showNavigator.checked,
  };
  if (settings.workdayEnd <= settings.workdayStart) {
    saved.textContent = 'The work day must end after it starts';
    return;
  }
  await chrome.storage.sync.set({ settings });
  saved.textContent = 'Saved';
  setTimeout(() => (saved.textContent = ''), 2000);
});

document.getElementById('time-zones').append(
  ...Intl.supportedValuesOf('timeZone').map((zone) => Object.assign(document.createElement('option'), { value: zone })),
);

async function start() {
  const requested = (new URLSearchParams(location.search).get('host') || '').toLowerCase();
  if (HOST_PATTERN.test(requested)) {
    await addHost(requested);
    history.replaceState(null, '', location.pathname);
  }
  await renderTokens(requested || null);
}

start();
renderSettings();
