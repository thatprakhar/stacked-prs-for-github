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
    if (pullRequest.isDraft) return { kind: 'draft' };
    const reviewed = humanReviewState(pullRequest);
    if (reviewed) return { kind: reviewed };
    const approvingBots = botApprovals(pullRequest);
    if (approvingBots.length > 0) return { kind: 'bot_approved', botApprovals: approvingBots };
    const hours = workHours(readyForReviewAt(pullRequest), now, settings);
    return { kind: 'awaiting', hours, level: slaLevel(hours, settings) };
  }

  const api = { DEFAULT_SETTINGS, reviewStatus, humanReviewState, botApprovals, readyForReviewAt, slaLevel };
  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
