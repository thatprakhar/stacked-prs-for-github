# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Images are in this directory; regenerate them with
`dev/store-assets.sh`. Upload `dist/stacked-prs-for-github-<version>.zip` from `npm run package`.

## Store listing tab

**Name** (from the manifest): Stacked PRs for GitHub

**Summary** (from the manifest, 132 characters at most):
See stacked pull requests as stacks on GitHub, with each one's author, review wait in work hours and an SLA pill.

**Category:** Developer Tools · **Language:** English

**Description:**

```
Stacked pull requests look like any other pull request in GitHub's list, and moving between the layers of a stack is slow. Stacked PRs for GitHub shows them as stacks.

On a repository's pull request list
• Each stack is one row you can expand, with its pull requests in order from the base branch up.
• A progress bar shows every pull request in the stack: merged, approved (by a person or a bot such as CodeRabbit), waiting or draft. Click a segment to open it.
• Every pull request shows its author, checks, comments and how long it has waited for its first human review.
• A blue bar marks pull requests updated since you last viewed them, as in GitHub's own list. A collapsed stack says how many of its pull requests were updated.
• An SLA pill marks each one as on track, at risk or breached. Click the counts at the top to filter.
• Switch back to GitHub's own list at any time.

On a pull request page
• A stack navigator shows the base branch, every pull request in the stack, where you are and which ones were updated since you last viewed them.
• Previous and next buttons keep you on the same tab, so Files changed stays Files changed.

Review time that is fair
• Counted in work hours only (your days, hours and time zone), from when the pull request was marked ready for review.
• Stops at the first review by a person, or at a bot's approval (shown as Bot approved). Other bot reviews and the author's own replies do not count.

Works with
• github.com and GitHub Enterprise Cloud (*.ghe.com).
• GitHub's native stacks (gh stack) and, when a stack is not linked, pull requests whose base branch is another's head branch.

Private by design
• You add your own GitHub token. It stays in your browser and is used only to call the GitHub API of that host.
• No server, no analytics, no tracking.
```

**Graphics:**

| Field | File |
|---|---|
| Store icon (128×128) | `icons/icon-128.png` |
| Screenshots (1280×800) | `store/screenshots/1-stacked-list.png`, `2-dark-overview.png`, `3-stack-navigator.png`, `4-settings.png` |
| Small promo tile (440×280) | `store/promo-tile.png` |

The screenshots use the fictional repository in `dev/demo.js`; no real pull requests appear in them.

## Privacy practices tab

**Single purpose:**
Shows GitHub pull requests grouped into their stacks, with how long each has waited for review, on GitHub's pull request
list and pull request pages.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's GitHub token, SLA and work-hours settings, and which stacks are expanded. |
| Host `https://api.github.com/*` | Reads pull requests, reviews, checks and stacks from the GitHub API for github.com, with the user's token. |
| Host `https://*.ghe.com/*` | GitHub Enterprise Cloud: each company has its own `<company>.ghe.com` host and `api.<company>.ghe.com` API. The extension shows its view on those pages and reads pull requests from that API. The company name is not known in advance, so the wildcard is needed. |
| Content scripts on `https://github.com/*` and `https://*.ghe.com/*` | Draws the stacked list on pull request list pages and the stack navigator on pull request pages. GitHub navigates without reloading, so the script must be present across the site to notice when one of those pages opens. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package.

**Data usage:** tick **Authentication information** (the GitHub token, stored on the device and sent only to the GitHub
API of its host) and **Website content** (pull request data read from the GitHub API to draw the page, not stored).
Then tick all three certifications: not sold or transferred to third parties outside the approved use cases, not used
for purposes unrelated to the single purpose, not used to determine creditworthiness.

**Privacy policy URL:** https://github.com/thatprakhar/stacked-prs-for-github/blob/main/store/privacy-policy.md

## Distribution tab

Visibility: **Public**, or **Unlisted** to share only by link while trying it with colleagues.
Regions: all.
