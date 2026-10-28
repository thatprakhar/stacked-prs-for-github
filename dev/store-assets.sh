#!/usr/bin/env bash
# Renders the Chrome Web Store screenshots (1280x800) and the small promo tile (440x280) into store/,
# from the fictional data in dev/demo.js. Needs Google Chrome and Node.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
export PORT="${PORT:-4399}"
PROFILE="$(mktemp -d)"
OPTIONS_PREVIEW="options/store-preview.html"

node dev/server.js >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER; rm -rf "$PROFILE" "$OPTIONS_PREVIEW"' EXIT
sleep 1

python3 -I - "$OPTIONS_PREVIEW" <<'PY'
import sys
page = open('options/options.html').read()
mock = """<script>
const store = { tokens: { 'github.com': 'token' }, hosts: ['acme.ghe.com'] };
window.chrome = {
  storage: {
    local: { async get(keys) { const result = {}; for (const key of [].concat(keys)) if (key in store) result[key] = store[key]; return result; }, async set(values) { Object.assign(store, values); } },
    sync: { async get() { return { settings: { timeZone: 'America/New_York' } }; }, async set() {} },
  },
  runtime: { async sendMessage(message) { return message.host === 'github.com' ? { ok: true, data: { viewer: { login: 'mira-chen' } } } : { ok: false, error: 'No token saved for acme.ghe.com' }; } },
};
</script>"""
open(sys.argv[1], 'w').write(page.replace('<script src="../src/shared/work-hours.js">', mock + '<script src="../src/shared/work-hours.js">'))
PY

shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" --force-device-scale-factor=1 \
    --window-size="$2" --virtual-time-budget="${4:-8000}" --screenshot="$1" "http://localhost:$PORT/$3" >/dev/null 2>&1
}

PREVIEW="dev/preview.html?demo&q=is%3Apr+is%3Aopen"
FILTERED="dev/preview.html?demo&q=is%3Aopen+label%3Acheckout+-is%3Adraft"
shot store/screenshots/1-stacked-view.png 1280,800 "$FILTERED"
shot store/screenshots/2-dark-overview.png 1280,800 "$PREVIEW&theme=dark"
shot store/screenshots/3-stack-navigator.png 1280,800 "dev/preview.html?demo&pr=203"
shot store/screenshots/4-settings.png 1280,800 "$OPTIONS_PREVIEW"
shot store/screenshots/5-what-changed.png 1280,800 "$PREVIEW&expand=stack-208&hover=%5Bdata-number%3D%22202%22%5D%20.ghs-unread-bar" 30000
shot store/screenshots/6-search.png 1280,800 "dev/preview.html?demo&q=is%3Aopen+author%3Amira-chen%2Csam-okafor+-label%3Adocs&type=review"
shot store/screenshots/7-issues.png 1280,800 "dev/preview.html?demo&issues&q=is%3Aopen"
shot store/screenshots/8-code-search.png 1280,800 "dev/preview.html?demo&home&type=applyDiscount"
shot store/promo-tile.png 440,280 "store/promo-tile.html"
ls -1 store/screenshots store/promo-tile.png
