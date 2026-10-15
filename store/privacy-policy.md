# Privacy policy: Stacked PRs for GitHub

Last updated: 15 October 2026

Stacked PRs for GitHub is a browser extension that shows pull requests on github.com and GitHub Enterprise Cloud
(`*.ghe.com`) grouped into stacks, with how long each has waited for review.

## What the extension handles

- **Your GitHub access token.** You paste it on the extension's settings page. It is saved in your browser's local
  extension storage (`chrome.storage.local`) on your device. It is sent only to the GitHub API of the host it belongs to
  (`api.github.com` or `api.<your-company>.ghe.com`), as the `Authorization` header of the extension's requests.
- **Pull request data.** To draw the page, the extension reads pull requests, reviews, checks and stacks from the GitHub
  API with your token. This data is kept in memory while the page is open and is not stored or sent anywhere else.
- **Settings.** Your SLA, work hours and time zone are saved with `chrome.storage.sync`, which your browser may sync to
  your other devices through your browser account. Whether stacks are expanded is saved in local extension storage.

## What the extension does not do

- It has no server. The developer receives no data of any kind: no analytics, no telemetry, no crash reports.
- It does not sell, share or transfer data to anyone, and does not use it for any purpose other than showing your pull
  requests.
- It does not read pages other than pull request lists and pull request pages on github.com and `*.ghe.com`.
- It does not load or run code from outside the extension.

## Removing your data

Remove a token with **Remove token** or **Remove host** on the settings page. Uninstalling the extension deletes
everything it stored. To revoke a token itself, use GitHub's token settings, or `gh auth logout` if it came from the
GitHub CLI.

## Contact

Questions: naharpra@gmail.com
