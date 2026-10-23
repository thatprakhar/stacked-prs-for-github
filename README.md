# Stacked PRs for GitHub

A Chrome extension that makes stacked pull requests easy to read on GitHub and GitHub Enterprise Cloud (`*.ghe.com`).

**[Install it from the Chrome Web Store](https://chromewebstore.google.com/detail/stacked-prs-for-github/cigdnnplddadnmbelifgciagkgcoclbe)**

- **Pull request list** (`/<owner>/<repo>/pulls`): replaces GitHub's flat list with a stacked view. Each stack is a
  collapsible row with its members in stack order, a progress bar (one segment per pull request, colored by review
  state, and green once a person or a bot such as CodeRabbit approved it; click a segment to open it) and the longest
  wait in the stack. Every row shows the author's avatar, checks,
  comments and a review SLA pill. As in GitHub's own list, a blue bar marks pull requests updated since you last
  viewed them; hover it to see what changed (commits, pushes, reviews, comments) since you last read the pull request.
  A stack's header says how many of its pull requests were updated, and hovering that lists them.
  The summary pills (SLA breached, at risk, on track) filter the list. Use the list icon to switch back to GitHub's own
  list.
- **Pull request page**: a floating stack navigator showing the base branch, every pull request in the stack, where you
  are, a blue dot on the ones updated since you last viewed them, and previous/next buttons that keep you on the same
  tab (Files changed stays Files changed).

Stacks come from GitHub's native stacks (`gh stack link`, REST `GET /repos/{owner}/{repo}/stacks`). Pull requests in
no native stack are still grouped when one's base branch is another's head branch ("Stack · from branches").

![The stacked view on a repository's pull request list](store/screenshots/1-stacked-list.png)

## Install

### 1. Add it to Chrome

Open [Stacked PRs for GitHub on the Chrome Web Store](https://chromewebstore.google.com/detail/stacked-prs-for-github/cigdnnplddadnmbelifgciagkgcoclbe) and click **Add to Chrome**. Chrome keeps it up to date.
Optional: pin it from the puzzle-piece menu in the toolbar. Its icon opens the settings page.

### 2. Add a GitHub token

1. Open any repository's **Pull requests** tab on github.com or your company's `*.ghe.com`.
2. The extension shows **Add a token**. Click it: the settings page opens with that host already added.
3. Paste a token and click **Save**. The row should then say *Signed in as* your username.

The quickest way to get a token is the GitHub CLI; the exact command for each host is shown on the settings page:

```sh
gh auth token --hostname github.com            # or your-company.ghe.com
```

Without the CLI, create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with read access
to **Pull requests** and **Metadata** on the repositories you use. The token stays in your browser and is used only by the
extension's background worker to call the GitHub API of that host; pages never see it.

### Uninstall

Right-click its toolbar icon and choose **Remove from Chrome**, or click **Remove** on its card in `chrome://extensions`.
This also deletes the saved tokens and settings.

## Review SLA

The clock starts at the latest *ready for review* event, or when the pull request was opened if it was never a draft,
and counts only work hours (default Mon–Fri 9:00–18:00 in the browser's time zone). It stops at the first review by a person,
or when a bot such as CodeRabbit approves. Other bot reviews and the author replying to comments do not count. Defaults:
SLA 6 hours, at risk after 3. All of this is editable in the settings page.

| Pill | Meaning |
|---|---|
| `7.2h · SLA breached` | Waited at least the SLA with no human review |
| `4.1h · At risk` | Waited at least the at-risk threshold |
| `1.0h · On track` | Below the at-risk threshold |
| Approved, Changes requested, Reviewed | A person has reviewed it; the clock has stopped |
| Bot approved | A bot such as CodeRabbit approved it and no person has reviewed it yet; the clock has stopped |
| Draft, Merged, Closed | Not on the clock |

## License

[MIT](LICENSE)
