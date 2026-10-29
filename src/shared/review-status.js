(function (root) {
  const workHours = root.GitHubStacks ? root.GitHubStacks.workHours : require('./work-hours.js').workHours;

  const DEFAULT_SETTINGS = {
    slaHours: 6,
    atRiskHours: 3,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    workdayStart: 9,
    workdayEnd: 18,
    workdays: [1, 2, 3, 4, 5],
    showNavigator: true,
    showIntentTrail: true,
    intentServer: '',
  };

  function isBot(actor) {
    if (!actor) return true;
    return actor.__typename === 'Bot' || /\[bot\]$/i.test(actor.login);
  }

  function latestStateByReviewer(pullRequest, fromBots) {
    const authorLogin = pullRequest.author ? pullRequest.author.login : null;
    const latestByReviewer = new Map();
    const reviews = (pullRequest.reviews && pullRequest.reviews.nodes) || [];
    for (const review of reviews) {
      if (review.state === 'PENDING' || !review.author || isBot(review.author) !== fromBots || review.author.login === authorLogin) continue;
      const previous = latestByReviewer.get(review.author.login);
      if (review.state === 'COMMENTED' && previous && previous !== 'COMMENTED') continue;
      latestByReviewer.set(review.author.login, review.state);
    }
    return latestByReviewer;
  }

  function botApprovals(pullRequest) {
    return [...latestStateByReviewer(pullRequest, true)].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
  }

  function humanReviewState(pullRequest) {
    const states = [...latestStateByReviewer(pullRequest, false).values()];
    if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
    if (states.includes('APPROVED')) return 'approved';
    if (states.length > 0) return 'reviewed';
    return null;
  }

  function reviewerName(reviewer) {
    return reviewer ? reviewer.login || reviewer.slug || reviewer.name || null : null;
  }

  // A re-review: after a person requested changes or commented, the author asked for review again (from them or
  // from someone else), and that request is still open. Returns when it was asked and who it waits on, or null.
  function reReviewRequest(pullRequest) {
    const state = humanReviewState(pullRequest);
    if (state !== 'changes_requested' && state !== 'reviewed') return null;
    const pending = ((pullRequest.reviewRequests && pullRequest.reviewRequests.nodes) || [])
      .map((request) => request.requestedReviewer)
      .filter((reviewer) => reviewer && !(reviewer.login && isBot(reviewer)))
      .map(reviewerName)
      .filter(Boolean);
    if (pending.length === 0) return null;
    const authorLogin = pullRequest.author ? pullRequest.author.login : null;
    const lastReview = Math.max(
      ...((pullRequest.reviews && pullRequest.reviews.nodes) || [])
        .filter((review) => review.state !== 'PENDING' && review.submittedAt && review.author && !isBot(review.author) && review.author.login !== authorLogin)
        .map((review) => Date.parse(review.submittedAt)),
    );
    const requests = ((pullRequest.reviewRequestEvents && pullRequest.reviewRequestEvents.nodes) || []).filter(
      (event) => event && event.createdAt && event.requestedReviewer && !(event.requestedReviewer.login && isBot(event.requestedReviewer)),
    );
    const latest = requests.reduce((last, event) => (!last || Date.parse(event.createdAt) > Date.parse(last.createdAt) ? event : last), null);
    if (!latest || !(Date.parse(latest.createdAt) > lastReview)) return null;
    return { requestedAt: latest.createdAt, requestedBy: latest.actor ? latest.actor.login : authorLogin, author: authorLogin, reviewers: pending };
  }

  function readyForReviewAt(pullRequest) {
    const events = (pullRequest.timelineItems && pullRequest.timelineItems.nodes) || [];
    const latest = events.length > 0 ? events[events.length - 1].createdAt : null;
    return Date.parse(latest || pullRequest.createdAt);
  }

  function slaLevel(hours, settings) {
    if (hours >= settings.slaHours) return 'breached';
    if (hours >= settings.atRiskHours) return 'at_risk';
    return 'on_track';
  }

  function reviewStatus(pullRequest, now, settings) {
    if (pullRequest.state === 'MERGED') return { kind: 'merged' };
    if (pullRequest.state === 'CLOSED') return { kind: 'closed' };
    // In the merge queue it is on its way in, so the review clock no longer matters.
    if (pullRequest.isInMergeQueue) {
      const entry = pullRequest.mergeQueueEntry || {};
      return {
        kind: 'queued',
        position: entry.position || null,
        state: entry.state || null,
        secondsToMerge: typeof entry.estimatedTimeToMerge === 'number' ? entry.estimatedTimeToMerge : null,
        url: entry.mergeQueue ? entry.mergeQueue.url : null,
      };
    }
    if (pullRequest.isDraft) return { kind: 'draft' };
    const reviewed = humanReviewState(pullRequest);
    if (reviewed) {
      // Asked to review again: back on the clock, from when it was asked.
      const again = reReviewRequest(pullRequest);
      if (!again) return { kind: reviewed };
      const hours = workHours(Date.parse(again.requestedAt), now, settings);
      return { kind: 'awaiting', hours, level: slaLevel(hours, settings), rereview: again };
    }
    const approvingBots = botApprovals(pullRequest);
    if (approvingBots.length > 0) return { kind: 'bot_approved', botApprovals: approvingBots };
    const hours = workHours(readyForReviewAt(pullRequest), now, settings);
    return { kind: 'awaiting', hours, level: slaLevel(hours, settings) };
  }

  const api = { DEFAULT_SETTINGS, reviewStatus, humanReviewState, reReviewRequest, botApprovals, readyForReviewAt, slaLevel };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
