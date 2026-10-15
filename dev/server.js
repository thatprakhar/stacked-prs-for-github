// Serves the extension next to dev/preview.html and answers its messages with the GitHub CLI's token,
// so the real content scripts can be tried against live data without loading the extension.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.GITHUB_HOST || 'github.com';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function gh(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', ['api', '--hostname', HOST, ...args], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(stderr || error.message), { notFound: /404/.test(stderr) }));
      else resolve(JSON.parse(stdout));
    });
    if (input) child.stdin.end(input);
  });
}

async function answer(message) {
  if (message.type === 'graphql') {
    const body = await gh(['graphql', '--input', '-'], JSON.stringify({ query: message.query, variables: message.variables }));
    return body.data;
  }
  if (message.type === 'rest') return gh([message.path.replace(/^\//, '')]);
  return null;
}

http
  .createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/message') {
      let body = '';
      for await (const chunk of request) body += chunk;
      try {
        const data = await answer(JSON.parse(body));
        response.end(JSON.stringify({ ok: true, data }));
      } catch (error) {
        response.end(JSON.stringify({ ok: false, error: error.message, code: error.notFound ? 'not_found' : 'error' }));
      }
      return;
    }
    const file = path.join(ROOT, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    response.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  })
  .listen(PORT, () => console.log(`Preview on http://localhost:${PORT}/dev/preview.html (data from ${HOST})`));
