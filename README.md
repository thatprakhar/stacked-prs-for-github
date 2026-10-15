# Stacked PRs for GitHub

A Chrome extension that makes stacked pull requests easy to read on GitHub and GitHub Enterprise Cloud (`*.ghe.com`).

- **Pull request list** (`/<owner>/<repo>/pulls`): replaces GitHub's flat list with a stacked view. Each stack is a
  collapsible row with its members in stack order, a progress bar (one segment per pull request, colored by review
  state; click a segment to open it) and the longest wait in the stack. Every row shows the author's avatar, checks,
  comments and a review SLA pill. The summary pills (SLA breached, at risk, on track) filter the list. Use the list icon
  to switch back to GitHub's own list.
- **Pull request page**: a floating stack navigator showing the base branch, every pull request in the stack, where you
  are, and previous/next buttons that keep you on the same tab (Files changed stays Files changed).

Stacks come from GitHub's native stacks (`gh stack link`, REST `GET /repos/{owner}/{repo}/stacks`). Pull requests in
no native stack are still grouped when one's base branch is another's head branch ("Stack · from branches").

## Review SLA

The clock starts at the latest *ready for review* event, or when the pull request was opened if it was never a draft,
and counts only work hours (default Mon–Fri 9:00–18:00 in the browser's time zone). It stops at the first review by a person:
bots (for example CodeRabbit) and the author replying to comments do not count. Defaults: SLA 6 hours, at risk after 3.
All of this is editable in the settings page.

| Pill | Meaning |
|---|---|
| `7.2h · SLA breached` | Waited at least the SLA with no human review |
| `4.1h · At risk` | Waited at least the at-risk threshold |
| `1.0h · On track` | Below the at-risk threshold |
| Approved, Changes requested, Reviewed | A person has reviewed it; the clock has stopped |
| Draft, Merged, Closed | Not on the clock |

## Install

1. Get the code: clone this repository, or unzip a release made with `npm run package`.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the directory.
3. Open any repository's pull requests page. The extension asks for a token; **Add a token** opens the settings page
   with that host already added (GitHub Enterprise hosts on `*.ghe.com` are added this way, or by hand at the bottom of
   the token list). Paste a token there. With the GitHub CLI:

   ```sh
   gh auth token --hostname <host> | pbcopy
   ```

   The exact command is shown under each host. A fine-grained token needs read access to pull requests and metadata.
   The token is kept in this browser's `chrome.storage.local` and used only by the background worker; it is never
   exposed to the page.

After pulling changes, click the reload icon on the extension's card in `chrome://extensions` and refresh GitHub.

## Publish to the Chrome Web Store

1. Raise `version` in `manifest.json` (every upload needs a higher one), run `npm test`, then `npm run package`.
2. In the [developer dashboard](https://chrome.google.com/webstore/devconsole), upload
   `dist/stacked-prs-for-github-<version>.zip` (a new item the first time, **Package → Upload new package** after).
3. Fill in the listing from [`store/listing.md`](store/listing.md) and submit for review. The privacy policy the
   listing links to is [`store/privacy-policy.md`](store/privacy-policy.md) in this repository.

## Develop

No build step and no dependencies. Node 22 or later.

| Purpose | Command |
|---|---|
| Unit tests (work hours, review state, stack grouping) | `npm test` |
| Live preview of the content scripts without installing | `GITHUB_HOST=<host> node dev/server.js`, then open the printed URL with `?host=<host>&repo=<owner>/<repo>&q=<search>` for the list or `&pr=<number>` for the navigator. The server answers API calls with the GitHub CLI's token. |
| Zip the extension to share (`dist/github-stacks-<version>.zip`) | `npm run package` |
| Render the store screenshots and promo tile from the fictional data in `dev/demo.js` | `dev/store-assets.sh` |
| Regenerate the icons | `python3 dev/make-icons.py icons` |

| Path | Holds |
|---|---|
| `manifest.json` | Manifest V3: content scripts on `github.com` and `*.ghe.com`, API host permissions |
| `src/background.js` | Holds the token and makes every GitHub API call |
| `src/shared/` | Pure logic shared with the tests: `work-hours.js`, `review-status.js`, `stacks.js` |
| `src/content/` | Page code: API client, rendering, the list view, the PR page navigator, `main.js` (routing and re-mounting on GitHub's client-side navigation) and `styles.css` (Primer CSS variables, so light and dark themes follow GitHub) |
| `options/` | Settings page: tokens per host (only `github.com` is listed until a `*.ghe.com` host is used or added), SLA and work hours |
| `dev/` | Preview server and page, fictional demo data, store asset and icon scripts |
| `store/` | Chrome Web Store listing text, privacy policy, screenshots and promo tile |

The list view finds GitHub's own list by taking the nearest common ancestor of the links to pull requests in the page,
hides it and inserts its own list before it, so it does not depend on GitHub's class names. It shows up to 200 pull
requests matching the search box query (or the `q` URL parameter).
