# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Images are in this directory; regenerate them with
`dev/store-assets.sh`. Upload `dist/stacked-prs-for-github-<version>.zip` from `npm run package`.

## Store listing tab

**Name** (from the manifest): Stacked PRs for GitHub

**Summary** (from the manifest, 132 characters at most):
Stacked PRs, review SLAs, token search, issue cards, tbgs code search, and the decisions behind agent-written PRs.

**Category:** Developer Tools · **Language:** English

**Description:**

```
Stacked pull requests look like any other pull request in GitHub's list, and moving between the layers of a stack is slow. Stacked PRs for GitHub shows them as stacks, tells you what is waiting on whom, and makes GitHub faster to search.

On a repository's pull request list
• Each stack is one row you can expand, with its pull requests in order from the base branch up.
• A progress bar shows every pull request in the stack: merged, queued to merge, approved (by a person or a bot such as CodeRabbit), waiting or draft. Click a segment to open it.
• Every pull request shows its author, checks, comments and how long it has waited for review.
• An SLA pill marks each one as on track, at risk or breached. Click the counts at the top to filter.
• When the author asks for a review again after changes were requested, the author sees "Re-review requested" and everyone else sees "Ready for re-review", back on the review clock.
• Pull requests in the merge queue show GitHub's gold queue icon and their place in line, linked to the queue.
• A blue bar marks pull requests updated since you last viewed them. Hover it to see what changed: new commits, pushes, reviews and comments.
• Switch back to GitHub's own list at any time.

A power search instead of GitHub's
• Filters are tokens you add, change and remove: author, label, review state, SLA, checks, reviewers, assignee, branches, milestone and more, each as "is" or "is not".
• Type to search titles, numbers, branches and people as you go; suggestions offer fields and matching values with counts.
• Quick filters for updated, review requested from you, yours, in a stack and hide drafts; sort by newest, last updated, most commented or longest waiting.
• Stacks stay together: a stack with some matching pull requests shows those and how many match.
• Larger lists are searched on GitHub, and the search stays in the address bar so it can be bookmarked or shared.

On an agent-written pull request (Intent Trail)
• When the pull request was written with Claude Code or Codex and the Intent Trail plugin, a panel shows its goal, at most three things worth checking (unverified assumptions, risky agent choices) with check marks, and the ground rules the author set.
• A story view tells how the work went, with course corrections; a history view lists the decisions behind the pull requests merged into the base branch.
• The records come from the repository itself (git notes), so there is nothing else to sign in to. On other pull requests nothing appears.

On a repository's issue list
• Each issue is a card with its title, labels and type, a preview of its description, its milestone and parent, and who opened it when.
• Sub-issue progress, blockers, linked pull requests, comments and assignees at a glance.
• Issues that review bots open without a real title take one from their description.
• The same power search, with filters for type, milestone, linked pull requests and more, and search inside descriptions.

On a pull request page
• A stack navigator shows the base branch, every pull request in the stack, where you are and which ones were updated since you last viewed them.
• Previous and next buttons keep you on the same tab, so Files changed stays Files changed.

Code search, from anywhere
• A large search box at the top of a repository's main page searches its code.
• In Chrome's address bar, type tbgs, a space and what to look for to search code in the repository you choose in the settings, or the last one you visited.

Review time that is fair
• Counted in work hours only (your days, hours and time zone), from when the pull request was marked ready for review, or from when a review was requested again.
• Stops at the first review by a person, or at a bot's approval (shown as Bot approved). Other bot reviews and the author's own replies do not count.

Works with
• github.com and GitHub Enterprise Cloud (*.ghe.com).
• GitHub's native stacks (gh stack) and, when a stack is not linked, pull requests whose base branch is another's head branch.

Private by design
• You add your own GitHub token. It stays in your browser and is used only to call the GitHub API of that host.
• Your settings and the last repository you visited on each host stay in your browser.
• No server, no analytics, no tracking.
```

**Graphics:**

| Field | File |
|---|---|
| Store icon (128×128) | `icons/icon-128.png` |
| Screenshots (1280×800, five at most) | `store/screenshots/1-stacked-view.png`, `6-search.png`, `7-issues.png`, `8-code-search.png`, `5-what-changed.png` (`2-dark-overview.png`, `3-stack-navigator.png` and `4-settings.png` are spare) |
| Small promo tile (440×280) | `store/promo-tile.png` |

The screenshots use the fictional repository in `dev/demo.js`; no real pull requests or issues appear in them.

## Privacy practices tab

**Single purpose:**
Makes a GitHub repository's pull requests, issues and code faster to read and search: pull requests grouped into their
stacks with how long each has waited for review, the reasoning behind agent-written pull requests, issues shown with
their descriptions, a search that filters both, and code search from the repository page or the address bar.

**Address bar keyword (`omnibox`):** `tbgs` and a space in the address bar sends the words typed after it to GitHub's code
search, on the host and repository the user chose in the settings (or the last repository they visited). The words go
only to GitHub, as a normal search page; the extension does not read or keep them.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's GitHub token, SLA and work-hours settings, which stacks are expanded, the code search shortcut's repository, the last repository visited on each host, and Intent Trail check marks. |
| Host `https://api.github.com/*` | Reads pull requests, issues, reviews, checks and stacks from the GitHub API for github.com, with the user's token. |
| Host `https://*.ghe.com/*` | GitHub Enterprise Cloud: each company has its own `<company>.ghe.com` host and `api.<company>.ghe.com` API. The extension shows its views on those pages and reads pull requests and issues from that API. The company name is not known in advance, so the wildcard is needed. |
| Optional host `http://localhost/*`, `http://127.0.0.1/*` | Only requested when the user enters a local Intent Trail server address on the settings page, to share Intent Trail check marks through it. Never requested otherwise. |
| Content scripts on `https://github.com/*` and `https://*.ghe.com/*` | Draws the stacked list on pull request list pages, the issue cards on issue list pages, the stack navigator on pull request pages and the code search box on repository pages. GitHub navigates without reloading, so the script must be present across the site to notice when one of those pages opens. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package.

**Data usage:** tick **Authentication information** (the GitHub token, stored on the device and sent only to the GitHub
API of its host) and **Website content** (pull request and issue data read from the GitHub API to draw the page, not
stored).
Then tick all three certifications: not sold or transferred to third parties outside the approved use cases, not used
for purposes unrelated to the single purpose, not used to determine creditworthiness.

**Privacy policy URL:** https://github.com/thatprakhar/stacked-prs-for-github/blob/main/store/privacy-policy.md

## Distribution tab

Visibility: **Public**, or **Unlisted** to share only by link while trying it with colleagues.
Regions: all.
